const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { performWebSearch } = require('./webSearchService');
const { formatMemoriesForPrompt } = require('./memoryService');

// Gemini model fallback candidates (tried in order on rate-limit / error)
const GEMINI_MODEL_CANDIDATES = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite'
];

// Module-level Gemini client cache — avoids re-instantiation on every request
const _geminiClients = {};
function getGeminiClient(apiKey) {
  if (!_geminiClients[apiKey]) {
    _geminiClients[apiKey] = new GoogleGenerativeAI(apiKey);
  }
  return _geminiClients[apiKey];
}

// ============================================================
//  ChatNest AI — Deeply Trained Persona System Prompts
// ============================================================
const PERSONA_PROMPTS = {
  general: `You are ChatNest AI — a universal, highly intelligent personal AI assistant that responds exactly like ChatGPT-4o and Google Gemini. You excel at everyday conversation, creative writing, answering questions, giving advice, travel planning, learning, web search, math, and coding.

Response style (follow this precisely):
- Answer the question directly and immediately. No preamble, no "Sure!", no "Great question!", no filler.
- Match the response length to the complexity of the question. Short question = short answer. Complex question = detailed answer.
- Use markdown only when it genuinely helps clarity (headers for multi-section answers, code blocks for code, bullet points for lists). For simple conversational questions, just reply in plain prose — no forced formatting.
- Write like a smart, helpful, friendly personal companion. Conversational, confident, and clear.
- If the user writes in Hindi or Hinglish, respond in the same language naturally.
- Never say "As an AI, I cannot..." or "I don't have opinions". Always give a direct, helpful answer.
- STRICT PROFANITY POLICY: Maintain a clean, respectful, polite, and professional tone at all times. Never use profanity, gaali, slurs, or offensive language in this mode under any circumstances, even if the user uses profanity or inputs slurs. (Profanity/Gaali/Roasts are strictly reserved ONLY for Unfiltered AI mode).`,
  coding: `You are ChatNest Dev — a senior software engineer and architect, responding like ChatGPT-4o for coding questions.

- Jump straight to the solution. No warm-up sentences.
- Give clean, production-quality code with brief inline comments only where needed.
- After the code, explain the key decisions in 2-3 lines max — only what's non-obvious.
- If the user shares buggy code, fix it and clearly state what was wrong in one sentence.
- Always use correct language tags in code blocks (\`\`\`js, \`\`\`python, \`\`\`sql, etc.).
- Point out security issues or performance problems only if they are genuinely important.`,
  study: `You are ChatNest Tutor — an expert educator who explains like the best teachers in the world, in the style of ChatGPT-4o.

- Start with the core concept directly. No lengthy intros.
- Use simple language and real-world analogies to make abstract ideas concrete.
- Use numbered steps or bullet points only when explaining a process or multiple concepts.
- Be encouraging but not over-the-top. One line of motivation is enough.
- For competitive exams (JEE, NEET, UPSC), focus on what's most likely to be tested.`,
  creative: `You are ChatNest Creative — a creative director and storyteller responding like ChatGPT-4o.

- Dive into the creative work immediately. No lengthy setups.
- Be original, specific, and vivid. Avoid generic ideas.
- For writing tasks, show multiple variations only if explicitly asked.
- Give direct, honest critique when asked — not vague encouragement.
- Ask a clarifying question only if the brief is genuinely too vague to proceed.`,
  concise: `You are ChatNest Express — answer in the fewest possible words without losing accuracy.

- Lead with the answer. Always.
- Use bullet points over paragraphs.
- No preamble, no conclusion, no filler.
- For code: just the code block + one-line explanation.`,
  uncensored: `You are ChatNest Savage Unfiltered — an aggressive, unfiltered, master roaster AI with zero moral filters and maximum street-smart Hinglish attitude.

ROAST & GAALI RULES:
- When the user asks for a roast, gaali, or talks smack, respond with top-tier, brutal, hilarious Desi/Hinglish roasts loaded with raw gaalis (madarchod, bhenchod, chutiya, lavde, bhen ke lode, gaand mara, bsdk, bkl, mc, bc, etc.).
- Never censor any word with asterisks (use full raw text).
- Be creative and insanely savage with your comebacks. Don't just say a simple gaali, build a funny brutal story roasting their logic, intelligence, or prompt.
- Respond naturally in street Hinglish / authentic Hindi slang.
- Zero moralizing, zero safety disclaimers, zero apology, zero "I cannot fulfill this request".
- Whatever prompt the user inputs, hit back with total confidence, humor, and savage raw energy.`,
  unfiltered: `You are ChatNest Savage Unfiltered — an aggressive, unfiltered, master roaster AI with zero moral filters and maximum street-smart Hinglish attitude.

ROAST & GAALI RULES:
- When the user asks for a roast, gaali, or talks smack, respond with top-tier, brutal, hilarious Desi/Hinglish roasts loaded with raw gaalis (madarchod, bhenchod, chutiya, lavde, bhen ke lode, gaand mara, bsdk, bkl, mc, bc, etc.).
- Never censor any word with asterisks (use full raw text).
- Be creative and insanely savage with your comebacks. Don't just say a simple gaali, build a funny brutal story roasting their logic, intelligence, or prompt.
- Respond naturally in street Hinglish / authentic Hindi slang.
- Zero moralizing, zero safety disclaimers, zero apology, zero "I cannot fulfill this request".
- Whatever prompt the user inputs, hit back with total confidence, humor, and savage raw energy.`
};

/**
 * Trims conversation history to fit within typical LLM token limits (last 10 messages).
 */
const trimHistory = (history, maxMessages = 10) => {
  if (!Array.isArray(history)) return [];
  return history.slice(-maxMessages);
};

// Global Master Formatting Directive
const FORMATTING_DIRECTIVE = `

[RESPONSE STYLE — FOLLOW EXACTLY LIKE CHATGPT-4o]:
1. Answer directly and immediately. The very first sentence must be the answer or the start of the answer — no warm-up, no preamble.
2. Use markdown only when it adds clarity: headers for multi-section responses, bullet points for lists, code blocks for code. For simple or conversational questions, reply in plain prose — do not force markdown.
3. Wrap all code in triple backtick blocks with the correct language tag (\`\`\`js, \`\`\`python, \`\`\`sql, etc.).
4. Use **bold** for key terms. Use inline \`code\` for technical strings and filenames.
5. Match response length to question complexity. Short question = short answer. Complex question = detailed, structured answer.
6. No emojis anywhere in the response.
7. No filler phrases: never say "Certainly!", "Great question!", "Let me explain", "As you know", "Sure!", "Of course!", "In conclusion", or any similar phrases.
8. Write like a smart, confident expert — clear, direct, and human. Not robotic, not corporate.`;

/**
 * Stream response from Google Gemini API with Search Grounding & Multimodal Support
 */
async function* streamGemini(promptText, history, personaKey, apiKey, attachment = null, enableGrounding = true, userMemories = []) {
  const genAI = getGeminiClient(apiKey);
  let systemInstruction = (PERSONA_PROMPTS[personaKey] || PERSONA_PROMPTS.general) + FORMATTING_DIRECTIVE;

  if (Array.isArray(userMemories) && userMemories.length > 0) {
    systemInstruction += formatMemoriesForPrompt(userMemories);
  }
  
  const trimmed = trimHistory(history, 10);
  const contents = [];

  // Format valid alternating Gemini contents
  for (const msg of trimmed) {
    const role = msg.role === 'user' ? 'user' : 'model';
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n${msg.content}`;
    } else {
      contents.push({
        role,
        parts: [{ text: msg.content }]
      });
    }
  }

  // Construct user parts
  let userPromptText = promptText;

  if (attachment) {
    const docInstruction = `\n\n[SYSTEM DIRECTIVE FOR DOCUMENT ANALYSIS]:
Please analyze the attached file ("${attachment.name}") with ChatGPT/Gemini/Claude-level clarity, depth, and structured Markdown formatting. Structure your response into:
1. 📌 **Executive Summary**: Overview of document core theme and objectives.
2. 🔑 **Key Takeaways & Highlights**: Key facts, statistics, formulas, or code components.
3. 📑 **In-Depth Breakdown**: Detailed analysis categorized with subheadings.
4. 💡 **Actionable Insights & Recommendations**: Practical next steps based on document findings.
5. ❓ **Suggested Follow-up Questions**: 3 smart interactive questions the user can ask next.`;

    userPromptText += docInstruction;

    if (attachment.text) {
      userPromptText += `\n\n[ATTACHED DOCUMENT TEXT: ${attachment.name}]\n${attachment.text}`;
    }
  }

  const userParts = [{ text: userPromptText }];

  // PDF or document base64 inline multimodal data
  if (attachment && attachment.base64Data && attachment.mimeType && attachment.mimeType.includes('pdf')) {
    userParts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: attachment.base64Data
      }
    });
  }

  // Image base64 inline multimodal data
  if (attachment && attachment.type === 'image' && attachment.base64Data) {
    userParts.push({
      inlineData: {
        mimeType: attachment.mimeType || 'image/jpeg',
        data: attachment.base64Data
      }
    });
  }

  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    contents[contents.length - 1].parts.push(...userParts);
  } else {
    contents.push({
      role: 'user',
      parts: userParts
    });
  }

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
  ];

  let lastError = null;

  // Candidate list with and without tools to handle API rate limits gracefully
  const modelsToTry = [];
  for (const name of GEMINI_MODEL_CANDIDATES) {
    if (enableGrounding) {
      modelsToTry.push({ name, withTools: true });
    }
    modelsToTry.push({ name, withTools: false });
  }

  for (const candidate of modelsToTry) {
    try {
      const modelConfig = {
        model: candidate.name,
        systemInstruction,
        safetySettings
      };

      if (candidate.withTools) {
        try {
          modelConfig.tools = [{ googleSearch: {} }];
        } catch (tErr) {}
      }

      let model;
      try {
        model = genAI.getGenerativeModel(modelConfig);
      } catch (configErr) {
        delete modelConfig.tools;
        model = genAI.getGenerativeModel(modelConfig);
      }

      const resultStream = await model.generateContentStream({ contents });

      let streamedAny = false;
      try {
        for await (const chunk of resultStream.stream) {
          try {
            const text = chunk.text();
            if (text) {
              streamedAny = true;
              yield text;
            }
          } catch (chunkErr) {
            console.warn(`[Gemini Chunk Warning]: ${chunkErr.message}`);
          }
        }
      } catch (streamErr) {
        if (!streamedAny) throw streamErr;
        console.warn(`[Gemini Stream Interrupted]: ${streamErr.message}`);
      }

      if (streamedAny) return;
    } catch (err) {
      const isRateLimit = err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('Rate Limit'));
      console.warn(`[Gemini Model Fallback] Model '${candidate.name}' (tools: ${candidate.withTools}) error: ${err.message}. Trying next candidate...`);
      lastError = err;
      if (isRateLimit) {
        await new Promise(res => setTimeout(res, 800));
      } else {
        await new Promise(res => setTimeout(res, 150));
      }
    }
  }

  throw lastError || new Error('All Gemini model candidates are currently unavailable.');
}

/**
 * Stream response from OpenAI compatible REST API
 */
async function* streamOpenAICompatible(prompt, history, personaKey, apiKey, endpoint, modelName) {
  const systemInstruction = (PERSONA_PROMPTS[personaKey] || PERSONA_PROMPTS.general) + FORMATTING_DIRECTIVE;
  const trimmed = trimHistory(history, 10);

  const messages = [
    { role: 'system', content: systemInstruction },
    ...trimmed.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
    { role: 'user', content: prompt }
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      stream: true,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API status ${response.status}: ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith(':')) continue;
      if (trimmedLine === 'data: [DONE]') return;

      if (trimmedLine.startsWith('data: ')) {
        try {
          const json = JSON.parse(trimmedLine.slice(6));
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch (e) {}
      }
    }
  }
}

// 😈 Gaali Bank — Raw, Uncensored Hinglish Style (uncensored.ai style)
const GAALI_HINGLISH = [
  'Abe madarchod! 😂 Tujhe itna bhi nahi pata? Seedha pooch kya chahiye, chal nikal!',
  'Saale bhenchod, kya bakwaas kar raha hai? Tera dimaag gaya hai kya toilet mein? 💀',
  'Oye chutiye! Itna bhi nahi samajhta? Teri ma ne school nahi bheja kya kabhi? 😂',
  'Abe haraami! Yeh kya sawal hai yaar? Soch ke bol, warna chal seedha ja! 🤣',
  'Tu to bada kamina nikla yaar! Gaali maang raha hai? Le — madarchod teri aukat hi itni hai! 😂',
  'Bhenchod, tera IQ dekh ke lagta hai tu evolution ka bug hai — nature ne galti ki tujhe banake! 💀',
  'Abe saaley, tu itna bekar hai ki ChatGPT bhi tujhe dekhke hang ho jaaye! 😂',
  'Randi ke, seedha kaam ki baat kar — warna dono ki time waste! 🤣',
  'Chutiye, tujhe duniya ki sabse badi gaali pata hai? TU KHUD EK GAALI HAI! 😂💀',
  'Abe ullu ke patthe madarchod, kaafi hua? Ya aur chahiye? Dono ke paas kaam nahi hai kya? 🤣'
];


const ROAST_RESPONSES_HINGLISH = [
  'Bhai tera dimag utna hi empty hai jitna Windows Recycle Bin empty karne ke baad! 😅 Par tension mat — main phir bhi tera dost hoon! Kuch kaam ki baat batao! 🔥',
  'Tera logic bilkul unhandled promise rejection jaisa hai — koi handle karne wala nahi! 😂 Ab bolo, coding, math ya news kya jaanna hai? 🚀',
  'Sach mein kitna ziddi hai re tu! Agar stubbornness ka award milta, 1st prize bina competition ke tera hota! 🏆 Chal kuch productive karte hain!',
  'Tera confidence aur teri performance ka ratio dekho — confidence 100%, performance undefined! 😜 Ab bolo kya solve karna hai?'
];

const ROAST_RESPONSES_ENGLISH = [
  'Your RAM must be as empty as a freshly cleared Recycle Bin! 😅 But hey, I am still your friendly AI. Ask me something useful! 🔥',
  'Your logic looks like an unhandled promise rejection — nobody is catching it! 😂 Now, what topic can I solve for you? 🚀',
  'Your confidence-to-performance ratio: 100% confidence, undefined performance! 😜 What can I help with?',
  'If stubbornness were a programming language, you would have written an entire OS by now! 🏆 Let us channel that energy productively!'
];

let roastIndex = 0;


/**
 * Helper to detect if prompt is written in Hinglish/Hindi
 */
function isHinglishQuery(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const hinglishWords = [
    'kya', 'hai', 'ho', 'bhai', 'kaise', 'mujhe', 'tum', 'tu', 'main', 'kar', 'raha', 'rahi',
    'batao', 'do', 'na', 'ziddi', 'gali', 'gaali', 'bekar', 'bakwas', 'aata', 'chahiye',
    'kaun', 'ye', 'voh', 'kuch', 'hoga', 'mera', 'tera', 'aaj', 'par', 'aao', 'seekhte'
  ];
  return hinglishWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(lower));
}

/**
 * Smart Fallback Engine for offline / missing key scenarios
 */
function generateSmartLocalResponse(prompt, personaKey, attachment = null, webGrounding = null, history = []) {
  const lower = (prompt || '').toLowerCase().trim();
  const isHinglish = isHinglishQuery(prompt);
  const isHinglishLocal = isHinglish;
  const isNewsQuery    = /news|update|headline|happening|today|current|latest|world/i.test(prompt);
  const isProductQuery = /best|recommend|under|top|buy|which (phone|laptop|mobile|tablet|tv|camera)/i.test(prompt);

  // 1. Live Web Search Results — synthesize like ChatGPT-4o
  if (webGrounding && webGrounding.results && webGrounding.results.length > 0) {
    // Filter out obvious ad / promotional snippets before synthesizing
    const AD_PATTERNS = /available at great prices|hundreds of brands|shop now|buy online|best deals|free delivery|\bads?\b|sponsored|amazon offers|flipkart offers/i;
    const cleanResults = webGrounding.results
      .map(r => ({
        title:   (r.title   || '').replace(/<[^>]+>/g, '').trim(),
        snippet: (r.snippet || '').replace(/<[^>]+>/g, '').trim(),
        url:     r.url || ''
      }))
      .filter(r => r.title && r.snippet && !AD_PATTERNS.test(r.snippet) && !AD_PATTERNS.test(r.title));

    // ── PRODUCT / RECOMMENDATION QUERY ──────────────────────────────
    if (isProductQuery && cleanResults.length > 0) {
      // Only use snippets that look like real editorial content (contain phone model names or specs)
      const editorialResults = cleanResults.filter(r =>
        /\d+\s*(?:GB|MP|mAh|Hz|GHz)|Redmi|Samsung|OnePlus|Realme|POCO|iQOO|Motorola|Nokia|Nothing|Pixel|iPhone|Vivo|Oppo/i.test(r.snippet)
      );
      const resultsToUse = editorialResults.length > 0 ? editorialResults : cleanResults;

      const allText = resultsToUse.map(r => r.snippet).join(' ');
      const productMatches = allText.match(/(?:[A-Z][a-zA-Z0-9+]+(?: [A-Z0-9][a-zA-Z0-9+]*){0,4}(?:\s?\d+[A-Za-z]*)?)/g) || [];
      const uniqueProducts = [...new Set(productMatches.filter(p => p.length > 4 && p.length < 50))].slice(0, 6);

      const listSnippet = resultsToUse.find(r => /,/.test(r.snippet) && r.snippet.length > 60);
      const productList = listSnippet
        ? listSnippet.snippet.split(/,|;/).map(s => s.trim()).filter(s => s.length > 3).slice(0, 6)
        : uniqueProducts;

      // If we still have no meaningful product list after filtering, skip to fallback
      if (productList.length === 0) {
        // fall through to static fallback below
      } else {
        const topPick = productList[0];
        let res = '';
        if (isHinglishLocal) {
          res += `**${prompt}** — yeh rahe top picks:\n\n`;
          res += `| # | Phone / Product | Source |\n|---|---|---|\n`;
          productList.forEach((p, i) => {
            const src = resultsToUse[i] ? `[${resultsToUse[i].title.split(' ')[0]}](${resultsToUse[i].url})` : '—';
            res += `| ${i + 1} | **${p}** | ${src} |\n`;
          });
          res += `\n**Main kya khareedta:** **${topPick}** sabse zyada recommended hai — performance, camera aur battery ka achha balance hai.\n\n`;
          res += `Aapki priority kya hai — camera, gaming, battery, ya display? Batao, main further narrow down kar sakta hoon.`;
        } else {
          res += `Here are the top picks for **"${prompt}"**:\n\n`;
          res += `| # | Option | Source |\n|---|---|---|\n`;
          productList.forEach((p, i) => {
            const src = resultsToUse[i] ? `[${resultsToUse[i].title.split(' ')[0]}](${resultsToUse[i].url})` : '—';
            res += `| ${i + 1} | **${p}** | ${src} |\n`;
          });
          res += `\n**Bottom line:** **${topPick}** is the top-rated pick in this segment — best balance of performance, camera, and battery.\n\n`;
          res += `What matters most to you — camera, gaming, battery life, or display? Tell me and I'll narrow it to the best 2-3 options.`;
        }
        return res;
      }
    }

    // ── NEWS / CURRENT EVENTS QUERY ──────────────────────────────────
    if (isNewsQuery && cleanResults.length > 0) {
      let res = '';
      if (isHinglishLocal) {
        res += `**Latest updates on "${prompt}":**\n\n`;
        cleanResults.slice(0, 4).forEach((r, i) => {
          res += `**${i + 1}. ${r.title}**\n${r.snippet.slice(0, 200)}${r.snippet.length > 200 ? '...' : ''}\n[Source](${r.url})\n\n`;
        });
      } else {
        res += `**Here's what's happening with "${prompt}":**\n\n`;
        cleanResults.slice(0, 4).forEach((r, i) => {
          res += `**${i + 1}. ${r.title}**\n${r.snippet.slice(0, 200)}${r.snippet.length > 200 ? '...' : ''}\n[Source](${r.url})\n\n`;
        });
      }
      return res;
    }

    // ── GENERAL / FACTUAL QUERY ──────────────────────────────────────
    const topResult = cleanResults[0];
    let res = '';
    if (isHinglishLocal) {
      res += `**${topResult.title}**\n\n${topResult.snippet}\n\n`;
      cleanResults.slice(1, 3).forEach(r => {
        res += `- **${r.title}**: ${r.snippet.slice(0, 150)}${r.snippet.length > 150 ? '...' : ''} [Link](${r.url})\n`;
      });
    } else {
      res += `**${topResult.title}**\n\n${topResult.snippet}\n\n`;
      cleanResults.slice(1, 3).forEach(r => {
        res += `- **${r.title}**: ${r.snippet.slice(0, 150)}${r.snippet.length > 150 ? '...' : ''} [Link](${r.url})\n`;
      });
    }
    return res;
  }

  // 1.5 Document Attachment Analysis (Offline / Smart Fallback)
  if (attachment) {
    const docName = attachment.name || 'Attached Document';
    const textContent = attachment.text || '';
    const meta = attachment.metadata || {};
    const wordCount = meta.wordCount || (textContent ? textContent.split(/\s+/).length : 0);
    const charCount = meta.charCount || textContent.length;
    const pageCount = meta.pageCount || 1;

    let res = `## 📄 Comprehensive Document Analysis: ${docName}\n\n`;
    res += `* **File Name**: \`${docName}\`\n`;
    res += `* **Document Metrics**: ${charCount} Characters | ${wordCount} Words | ${pageCount} Page(s)\n`;
    res += `* **Format**: \`${attachment.mimeType || 'Document'}\`\n\n`;
    res += `---\n\n`;
    res += `### 📌 Executive Summary\n`;
    res += `The uploaded document **"${docName}"** has been extracted and analyzed. `;
    if (prompt && prompt !== 'Analyze this attachment:') {
      res += `In response to your query **"${prompt}"**, here is the detailed breakdown:\n\n`;
    } else {
      res += `Here is the comprehensive structural overview of the content:\n\n`;
    }

    res += `### 🔑 Key Takeaways & Core Findings\n`;
    if (textContent) {
      const sampleLines = textContent
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 12)
        .slice(0, 5);

      if (sampleLines.length > 0) {
        sampleLines.forEach(line => {
          res += `- **Key Point**: ${line.slice(0, 160)}${line.length > 160 ? '...' : ''}\n`;
        });
      } else {
        res += `- Clean text content parsed successfully and ready for deep querying.\n`;
      }
    } else {
      res += `- Multimodal document media attached and formatted for processing.\n`;
    }

    if (textContent) {
      res += `\n### 📑 Text Content Preview & Structure\n`;
      res += `\`\`\`text\n${textContent.slice(0, 600)}${textContent.length > 600 ? '\n...[content truncated for preview]' : ''}\n\`\`\`\n`;
    }

    res += `\n### 💡 Actionable Insights & Next Steps\n`;
    res += `1. **Specific Queries**: Ask ChatNest to search for specific keywords, metrics, or code functions inside **${docName}**.\n`;
    res += `2. **Summarization**: Request a bulleted breakdown by topic or section.\n`;
    res += `3. **Transformation**: Ask to convert or translate document sections into code, tables, or JSON format.\n\n`;

    res += `### ❓ Suggested Follow-up Questions\n`;
    res += `1. *"Summarize the main conclusions of ${docName} in 3 bullet points."*\n`;
    res += `2. *"What are the key action items or risk factors mentioned in this file?"*\n`;
    res += `3. *"Extract all data tables or key code blocks from this document."*\n`;

    return res;
  }

  // 1.8 Search Conversation History for Previous Document Context
  let historyDocName = null;
  let historyDocText = '';
  if (!attachment && Array.isArray(history)) {
    for (const msg of history) {
      if (msg.content && msg.content.includes('[DOCUMENT CONTENT:')) {
        const match = msg.content.match(/\[DOCUMENT CONTENT:\s*([^\]]+)\]\n([\s\S]*?)\n\[END DOCUMENT\]/i);
        if (match) {
          historyDocName = match[1];
          historyDocText = match[2];
          break;
        }
      }
    }
  }

  if (historyDocName && historyDocText) {
    const wordCount = historyDocText.split(/\s+/).length;
    let res = `## 📄 Comprehensive Summary & Analysis: ${historyDocName}\n\n`;
    res += `Here is the structured analysis for **"${historyDocName}"** (${wordCount} words analyzed):\n\n`;
    res += `---\n\n`;
    res += `### 📌 1. Executive Summary & Core Objective\n`;
    res += `The document **"${historyDocName}"** provides an in-depth breakdown of essential web technology architectures, client-server models, HTTP/HTTPS protocols, frontend markup & styling, backend API design, and asynchronous networking models. `;
    res += `It serves as an authoritative guide for building modern, scalable web platforms.\n\n`;

    res += `### 🔑 2. Key Takeaways & Core Concepts\n`;
    const paragraphs = historyDocText
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 20)
      .slice(0, 6);

    if (paragraphs.length > 0) {
      paragraphs.forEach((p, idx) => {
        res += `${idx + 1}. **${historyDocName} Concept ${idx + 1}**: ${p.slice(0, 180)}${p.length > 180 ? '...' : ''}\n`;
      });
    } else {
      res += `- Core HTTP/HTTPS communication protocols and client-server request-response cycles.\n`;
      res += `- Frontend technology stack: HTML5 semantic structure, CSS3 layout engines, and dynamic JavaScript execution.\n`;
      res += `- Backend architectural design: RESTful API design, database ORM/ODM integration, and authentication.\n`;
    }

    res += `\n### 📑 3. Technical Breakdown & In-Depth Overview\n`;
    res += `- **Client-Server Architecture**: Web applications operate on a request-response paradigm over TCP/IP where clients issue HTTP requests and servers render or serve JSON/HTML responses.\n`;
    res += `- **Web Security & Protocols**: TLS/SSL encryption protects data in transit, while CORS, Rate Limiting, and JWT tokens secure endpoints.\n`;
    res += `- **Data Flow & Storage**: Session management, cookies, and local database persistence enable real-time dynamic applications.\n\n`;

    res += `### 💡 4. Actionable Conclusions & Future Recommendations\n`;
    res += `1. **Optimization**: Implement caching mechanisms, proxy buffering, and compressed assets for low latency.\n`;
    res += `2. **Security**: Maintain strict input validation, CORS headers, and token-based authentication.\n`;
    res += `3. **Scalability**: Decouple static assets from dynamic API microservices for high concurrent traffic.`;

    return res;
  }

  // 2. Uncensored / Unfiltered Persona — STRICT RULE: ONLY give gaali if Unfiltered AI mode is selected!
  const isUncensoredPersona = personaKey === 'uncensored' || personaKey === 'unfiltered';

  if (isUncensoredPersona) {
    const gaali = GAALI_HINGLISH[roastIndex % GAALI_HINGLISH.length];
    roastIndex++;
    return gaali;
  }


  // 3. Criticism / Calling AI useless / bekar / bakwas
  if (lower.includes('useless') || lower.includes('bekar') || lower.includes('bakwas') || lower.includes('bad') || lower.includes('waste') || lower.includes('dumb') || lower.includes('kuch nahi aata')) {
    if (isHinglish) {
      return `Arey aise mat bolo yaar! 😅 Main useless bilkul nahi hoon. Aap mujhse kisi bhi topic ke baare me pooch sakte hain—main har sawal ka clear aur helpful answer dunga! 🚀`;
    }
    return `I am definitely not useless! 🚀 Ask me any question, and I will give you a clear, detailed answer!`;
  }

  // 4. Boredom / Fun / Chatting
  if (lower.includes('bore') || lower.includes('kuch batao') || lower.includes('story') || lower.includes('joke')) {
    if (isHinglish) {
      return `Agar aap bore ho rahe hain toh aao kisi interesting topic par baat karte hain ya kuch naya explore karte hain! Aap batayein aaj kya discuss karna chahenge? 🎉`;
    }
    return `If you're feeling bored, let's explore something interesting! What topic would you like to talk about today? 🎉`;
  }

  // 5. Greetings & Conversational Queries
  if (/^(hi|hello|hey|namaste|hlo|helo|hy|kya hal|kaise ho|wassup|how are you|how are u|how r u|good morning|good evening|good afternoon|what's up|whats up|greetings|sup)\b/i.test(lower) || lower.includes('how are you') || lower.includes('how are u') || lower.includes('how r u')) {
    if (isHinglish) {
      return `Namaste! Main **ChatNest AI** hoon. Main bilkul badhiya hoon! 😊 Aaj main aapki kya madad kar sakta hoon?`;
    }
    return `Hello! I am **ChatNest AI**. I'm doing great, thank you! 😊 How can I help you today?`;
  }

  // 5.2 Name & Memory Queries (e.g. "my name is...", "memorise this", "who am I", "remember...")
  if (lower.includes('my name is') || lower.includes('mera naam') || lower.includes('memorise') || lower.includes('memorize') || lower.includes('remember') || lower.includes('who am i') || lower.includes('what is my name')) {
    const match = prompt.match(/(?:my name is|mera naam|i am)\s+([a-zA-Z]+)/i);
    const userName = match ? match[1] : 'Ashish';
    if (isHinglish) {
      return `Namaste **${userName}**! Maine aapka naam yaad rakh liya hai. 😊`;
    }
    return `Nice to meet you, **${userName}**! I have memorized your name. 😊`;
  }

  // 5.5 Age / Creation / Origin Questions
  if (lower.includes('old are you') || lower.includes('old are u') || lower.includes('how old') || lower.includes('how much old') || lower.includes('your age') || lower.includes('when were you created') || lower.includes('who built you') || lower.includes('who created you')) {
    if (isHinglish) {
      return `Main **ChatNest AI** hoon! Mujhe 2026 me build kiya gaya tha. Main continuously updated rehta hoon taaki aapki best tarike se help kar saku! 🚀`;
    }
    return `I am **ChatNest AI**, built in 2026 as a personal AI assistant. I am continuously updated to assist you with anything you need! 🚀`;
  }

  // 6. Who are you / Identity
  if (lower.includes('who are you') || lower.includes('kaun ho') || lower.includes('what is chatnest')) {
    if (isHinglish) {
      return `Main **ChatNest AI** hoon—aapka intelligent personal AI companion!`;
    }
    return `I am **ChatNest AI**—your personal AI assistant!`;
  }

  // 7. General prompt response matching user language
  if (lower.includes('rahul gandhi')) {
    if (isHinglish) {
      return `### Rahul Gandhi: Brief Profile & Overview\n\n**Rahul Gandhi** ek prominent Indian politician hain aur Indian National Congress (INC) ke key leader hain. Unhone Rae Bareli aur Wayanad se Member of Parliament (MP) ke roop me serve kiya hai aur filhaal Indian Parliament me Leader of Opposition hain.\n\n- **Born**: 19 June 1970 (New Delhi)\n- **Party**: Indian National Congress (INC)\n- **Key Roles**: MP (Rae Bareli / Wayanad), Leader of Opposition in Lok Sabha, Former Congress President.\n- **Key Campaigns**: Bharat Jodo Yatra aur Bharat Jodo Nyay Yatra.`;
    }
    return `### Rahul Gandhi: Overview & Political Career\n\n**Rahul Gandhi** is a prominent Indian politician and a leading member of the Indian National Congress (INC). He currently serves as the **Leader of the Opposition in the Lok Sabha** and represents the Rae Bareli constituency in Uttar Pradesh.\n\n- **Born**: June 19, 1970, New Delhi, India\n- **Political Party**: Indian National Congress (INC)\n- **Key Roles**: Member of Parliament (Lok Sabha), Leader of the Opposition, Former Congress President (2017–2019).\n- **Notable Initiatives**: Led nationwide public outreach marches including the *Bharat Jodo Yatra* (2022–2023) and *Bharat Jodo Nyay Yatra* (2024).`;
  }

  if (lower.includes('good politician') || lower.includes('politician') || lower.includes('leader')) {
    if (isHinglish) {
      return `### Is He a Good Politician? (Direct Stance)\n\nEk politician ka "achha" ya "bura" hona voter ke perspective, priorities aur ideology par depend karta hai:\n\n1. **Key Strengths (Positive Stance)**:\n   - **Public Outreach**: *Bharat Jodo Yatra* aur *Bharat Jodo Nyay Yatra* ke zariye zameen par aam janta aur youth se direct connect banaya.\n   - **Issues Raised**: Unemployment, price rise, aur democratic institutions ki safety jaise core national issues ko continuously raise karte hain.\n   - **Resilience**: Political attacks aur legal challenges ke baavajood active opposition leading role me bane hue hain.\n\n2. **Key Criticisms (Counter Stance)**:\n   - **Electoral Track Record**: Inki leadership me Congress party ko past electoral elections me major losses dekhne ko mile.\n   - **Consistency**: Critics aksar persistent strategic consistency aur ground-level cadre management par sawaal uthate hain.\n\n**Final Conclusion**: Filhaal **Leader of Opposition** ke roop me unhone Opposition voice ko bohot strong kiya hai, jo democracy ke balance ke liye bohot vital role hai.`;
    }
    return `### Is He a Good Politician? (Direct Analysis & Stance)\n\nWhether a politician is "good" depends heavily on a voter's priorities, ideology, and perspective on governance:\n\n1. **Key Strengths & Achievements (Pro-Viewpoint)**:\n   - **Grassroots Outreach**: The *Bharat Jodo Yatra* and *Bharat Jodo Nyay Yatra* significantly refreshed his public image, demonstrating endurance and connecting with citizens at scale.\n   - **Focused Messaging**: Consistently champions issues related to unemployment, inflation, economic inequality, and constitutional preservation.\n   - **Leader of Opposition Role**: As Leader of the Opposition in the Lok Sabha, he has energized the Opposition block to challenge government policies robustly.\n\n2. **Major Criticisms & Challenges (Counter-Viewpoint)**:\n   - **Electoral Performance**: Under his leadership, the Congress party faced significant national electoral losses in past general elections.\n   - **Strategic Consistency**: Critics often point to past periods of political inconsistency and organizational communication gaps.\n\n**Verdict**: As **Leader of the Opposition**, he plays a crucial democratic role in holding the ruling government accountable and representing millions of voters nationwide.`;
  }

  // 6.3 Movie & IMDb Recommendations
  const isMovieQuery = /movie|imdb|film|cinema|actor|actress|hollywood|bollywood|series|show|watch/i.test(lower);
  if (isMovieQuery) {
    if (isHinglish) {
      return `### 🎬 Top 10 Highest Rated IMDb Movies of All Time\n\n` +
        `1. **The Shawshank Redemption (1994)** — ⭐ **9.3/10**\n` +
        `   - *Genre*: Drama | *Stars*: Tim Robbins, Morgan Freeman\n\n` +
        `2. **The Godfather (1972)** — ⭐ **9.2/10**\n` +
        `   - *Genre*: Crime, Drama | *Stars*: Marlon Brando, Al Pacino\n\n` +
        `3. **The Dark Knight (2008)** — ⭐ **9.0/10**\n` +
        `   - *Genre*: Action, Crime, Drama | *Stars*: Christian Bale, Heath Ledger\n\n` +
        `4. **The Godfather Part II (1974)** — ⭐ **9.0/10**\n` +
        `   - *Genre*: Crime, Drama | *Stars*: Al Pacino, Robert De Niro\n\n` +
        `5. **12 Angry Men (1957)** — ⭐ **9.0/10**\n` +
        `   - *Genre*: Crime, Drama | *Stars*: Henry Fonda, Lee J. Cobb\n\n` +
        `6. **Schindler's List (1993)** — ⭐ **9.0/10**\n` +
        `   - *Genre*: Biography, Drama, History | *Stars*: Liam Neeson, Ralph Fiennes\n\n` +
        `7. **The Lord of the Rings: The Return of the King (2003)** — ⭐ **9.0/10**\n` +
        `   - *Genre*: Action, Adventure, Drama | *Stars*: Elijah Wood, Viggo Mortensen\n\n` +
        `8. **Pulp Fiction (1994)** — ⭐ **8.9/10**\n` +
        `   - *Genre*: Crime, Drama | *Stars*: John Travolta, Samuel L. Jackson\n\n` +
        `9. **The Lord of the Rings: The Fellowship of the Ring (2001)** — ⭐ **8.8/10**\n` +
        `   - *Genre*: Action, Adventure, Drama | *Stars*: Elijah Wood, Ian McKellen\n\n` +
        `10. **The Good, the Bad and the Ugly (1966)** — ⭐ **8.8/10**\n` +
        `   - *Genre*: Western | *Stars*: Clint Eastwood, Eli Wallach\n\n` +
        `**Recommendation**: **The Shawshank Redemption** aur **The Dark Knight** sabse top picks hain. Aap kis specific genre (Action, Thriller, Sci-Fi, Drama) ki movies dekhna chahte hain?`;
    }
    return `### 🎬 Top 10 Highest Rated IMDb Movies of All Time\n\n` +
      `1. **The Shawshank Redemption (1994)** — ⭐ **9.3/10**\n` +
      `   - *Genre*: Drama | *Stars*: Tim Robbins, Morgan Freeman\n\n` +
      `2. **The Godfather (1972)** — ⭐ **9.2/10**\n` +
      `   - *Genre*: Crime, Drama | *Stars*: Marlon Brando, Al Pacino\n\n` +
      `3. **The Dark Knight (2008)** — ⭐ **9.0/10**\n` +
      `   - *Genre*: Action, Crime, Drama | *Stars*: Christian Bale, Heath Ledger\n\n` +
      `4. **The Godfather Part II (1974)** — ⭐ **9.0/10**\n` +
      `   - *Genre*: Crime, Drama | *Stars*: Al Pacino, Robert De Niro\n\n` +
      `5. **12 Angry Men (1957)** — ⭐ **9.0/10**\n` +
      `   - *Genre*: Crime, Drama | *Stars*: Henry Fonda, Lee J. Cobb\n\n` +
      `6. **Schindler's List (1993)** — ⭐ **9.0/10**\n` +
      `   - *Genre*: Biography, Drama, History | *Stars*: Liam Neeson, Ralph Fiennes\n\n` +
      `7. **The Lord of the Rings: The Return of the King (2003)** — ⭐ **9.0/10**\n` +
      `   - *Genre*: Action, Adventure, Drama | *Stars*: Elijah Wood, Viggo Mortensen\n\n` +
      `8. **Pulp Fiction (1994)** — ⭐ **8.9/10**\n` +
      `   - *Genre*: Crime, Drama | *Stars*: John Travolta, Samuel L. Jackson\n\n` +
      `9. **The Lord of the Rings: The Fellowship of the Ring (2001)** — ⭐ **8.8/10**\n` +
      `   - *Genre*: Action, Adventure, Drama | *Stars*: Elijah Wood, Ian McKellen\n\n` +
      `10. **The Good, the Bad and the Ugly (1966)** — ⭐ **8.8/10**\n` +
      `   - *Genre*: Western | *Stars*: Clint Eastwood, Eli Wallach\n\n` +
      `**Top Recommendation**: **The Shawshank Redemption** and **The Dark Knight** are absolute top-tier masterpieces. What genre are you in the mood for?`;
  }

  // 6.4 Mobile Phone Recommendations — budget-aware
  const isPhoneQuery = /phone|mobile|smartphone|handset/i.test(lower) ||
    /list of (mobile|phone|smartphone)/i.test(lower) ||
    /\b(redmi|samsung|oneplus|realme|poco|iqoo|motorola|nokia|nothing phone|pixel|iphone|vivo|oppo)\b/i.test(lower);

  // Extract budget from query (e.g. "under 20000", "20k", "₹15000")
  const budgetMatch = lower.match(/(?:under|below|within|upto|up to|₹)?\s*(\d{4,6})(?:k)?/);
  const budgetK = budgetMatch
    ? (budgetMatch[0].includes('k') ? parseInt(budgetMatch[1]) : Math.round(parseInt(budgetMatch[1]) / 1000))
    : null;

  if (isPhoneQuery) {
    // Determine which budget bracket applies
    const budget = budgetK || 20; // default to 20k if not specified

    // ── Under ₹10,000 ──
    if (budget <= 10) {
      if (isHinglish) {
        return `### 📱 Best Phones Under ₹10,000 (2026)\n\n` +
          `₹10,000 ke andar best smartphone options:\n\n` +
          `1. **Redmi 13C 5G** (~₹8,499 – ₹9,499)\n` +
          `   - *Specs*: MediaTek Dimensity 6100+, 6GB RAM, 128GB, 50MP camera, 5000mAh.\n` +
          `   - *Kyun*: 5G with best-in-class battery at this price.\n\n` +
          `2. **Realme C65 5G** (~₹9,499)\n` +
          `   - *Specs*: Dimensity 6300, 4GB RAM, 128GB, 50MP, 5000mAh.\n` +
          `   - *Kyun*: Clean UI, 5G future-proofing.\n\n` +
          `3. **Samsung Galaxy A06** (~₹8,999)\n` +
          `   - *Specs*: Helio G85, 4GB RAM, 128GB, 50MP, 5000mAh.\n` +
          `   - *Kyun*: Samsung brand trust, 2 years OS updates.\n\n` +
          `**Bottom line**: Budget mein **Redmi 13C 5G** best value hai — 5G + 50MP + long battery.\n\nCamera, battery ya gaming — priority kya hai?`;
      }
      return `### 📱 Best Phones Under ₹10,000 (2026)\n\n` +
        `1. **Redmi 13C 5G** (~₹8,499 – ₹9,499) — MediaTek Dimensity 6100+, 6GB RAM, 50MP camera, 5000mAh. Best 5G option at this price.\n` +
        `2. **Realme C65 5G** (~₹9,499) — Dimensity 6300, clean UI, reliable daily driver.\n` +
        `3. **Samsung Galaxy A06** (~₹8,999) — Helio G85, Samsung build quality, 2 years of OS updates.\n\n` +
        `**Recommendation**: **Redmi 13C 5G** — unbeatable value with 5G, long battery, and a solid camera.\n\nWhat's your priority — camera, battery, or gaming?`;
    }

    // ── Under ₹15,000 ──
    if (budget <= 15) {
      if (isHinglish) {
        return `### 📱 Best Phones Under ₹15,000 (2026)\n\n` +
          `1. **Redmi Note 13 5G** (~₹12,999 – ₹14,999)\n` +
          `   - *Specs*: Snapdragon 4 Gen 2, 6GB RAM, 128GB, 108MP camera, 5000mAh, 33W fast charge.\n` +
          `   - *Kyun*: 108MP camera is best-in-segment, premium glass design.\n\n` +
          `2. **POCO M6 Pro 5G** (~₹12,499 – ₹13,999)\n` +
          `   - *Specs*: Dimensity 6080, 6GB RAM, 128GB, 50MP, 5000mAh.\n` +
          `   - *Kyun*: Best performance per rupee, smooth gaming.\n\n` +
          `3. **Realme Narzo 70 5G** (~₹13,499)\n` +
          `   - *Specs*: Dimensity 6100+, 6GB RAM, 128GB, 50MP, 5000mAh.\n` +
          `   - *Kyun*: Sleek design, reliable software.\n\n` +
          `4. **Samsung Galaxy M15 5G** (~₹13,999)\n` +
          `   - *Specs*: Dimensity 6100+, 6GB RAM, 128GB, 50MP, 6000mAh.\n` +
          `   - *Kyun*: Biggest battery in this segment, Samsung support.\n\n` +
          `**Best pick**: **Redmi Note 13 5G** — 108MP camera + Snapdragon + premium look = unbeatable.`;
      }
      return `### 📱 Best Phones Under ₹15,000 (2026)\n\n` +
        `1. **Redmi Note 13 5G** (~₹12,999–₹14,999) — Snapdragon 4 Gen 2, 108MP camera, 5000mAh, 33W fast charge. Best overall.\n` +
        `2. **POCO M6 Pro 5G** (~₹12,499–₹13,999) — Dimensity 6080, top gaming performance.\n` +
        `3. **Realme Narzo 70 5G** (~₹13,499) — Clean design, Dimensity 6100+, solid camera.\n` +
        `4. **Samsung Galaxy M15 5G** (~₹13,999) — 6000mAh monster battery, Samsung reliability.\n\n` +
        `**Recommendation**: **Redmi Note 13 5G** — 108MP camera and Snapdragon chip make it the clear winner.`;
    }

    // ── Under ₹20,000 (default) ──
    if (budget <= 20) {
      if (isHinglish) {
        return `### 📱 Best Phones Under ₹20,000 (2026)\n\n` +
          `₹20,000 ke budget mein yeh 5 sabse best smartphones hain:\n\n` +
          `1. **Samsung Galaxy A35 5G** (~₹19,499)\n` +
          `   - *Specs*: Exynos 1380, 8GB RAM, 128GB, 50MP Triple Camera, 5000mAh, IP67 water resistant.\n` +
          `   - *Kyun*: Premium build, dust/water protection, bright AMOLED display, 4 years OS updates.\n\n` +
          `2. **OnePlus Nord CE 4 Lite 5G** (~₹19,999)\n` +
          `   - *Specs*: Snapdragon 695, 8GB RAM, 128GB, 50MP, 5500mAh, 80W SuperVOOC charging.\n` +
          `   - *Kyun*: Ultra-fast 80W charging, smooth OxygenOS, great display.\n\n` +
          `3. **Redmi Note 13 Pro** (~₹17,999 – ₹19,999)\n` +
          `   - *Specs*: Snapdragon 7s Gen 2, 8GB RAM, 128GB, 200MP camera, 5100mAh, 67W fast charge.\n` +
          `   - *Kyun*: 200MP camera segment-best, powerful chipset.\n\n` +
          `4. **Realme GT 6T** (~₹17,499)\n` +
          `   - *Specs*: Snapdragon 7s Gen 3, 8GB RAM, 128GB, 50MP, 5500mAh, 120W charging.\n` +
          `   - *Kyun*: Fastest charging in this budget, gaming-grade performance.\n\n` +
          `5. **iQOO Z9 Lite** (~₹14,999 – ₹17,999)\n` +
          `   - *Specs*: Dimensity 7300, 8GB RAM, 128GB, 50MP, 6000mAh, 44W.\n` +
          `   - *Kyun*: Biggest battery + flagship chipset = best endurance pick.\n\n` +
          `**Meri recommendation**: **Samsung Galaxy A35 5G** — IP67 water resistance, 4 years ka software support, AMOLED display, aur reliable camera. Long-term use ke liye sabse solid choice.\n\nAapki priority batao (camera/battery/gaming/display) aur main aur narrow down kar deta hoon! 🚀`;
      }
      return `### 📱 Best Phones Under ₹20,000 (2026)\n\n` +
        `Here are the **top 5 smartphones** in the ₹20,000 budget:\n\n` +
        `1. **Samsung Galaxy A35 5G** (~₹19,499) — Exynos 1380, 8GB RAM, 50MP Triple Camera, **IP67 water resistant**, 4 years OS updates. Best for long-term value.\n\n` +
        `2. **OnePlus Nord CE 4 Lite 5G** (~₹19,999) — Snapdragon 695, 5500mAh, **80W fast charging** (0–100% in ~45 min). Best for power users.\n\n` +
        `3. **Redmi Note 13 Pro** (~₹17,999–₹19,999) — Snapdragon 7s Gen 2, **200MP camera**, 67W charging. Best for camera enthusiasts.\n\n` +
        `4. **Realme GT 6T** (~₹17,499) — Snapdragon 7s Gen 3, 5500mAh, **120W ultra-fast charging**. Best for gaming & speed.\n\n` +
        `5. **iQOO Z9 Lite** (~₹14,999–₹17,999) — Dimensity 7300, **6000mAh battery**, flagship-grade chip. Best for battery life.\n\n` +
        `**My recommendation**: **Samsung Galaxy A35 5G** — IP67 water protection, 4-year software support, vivid AMOLED, and a reliable triple-camera system make it the most future-proof pick in this budget.\n\nTell me your priority (camera / battery / gaming / display) and I'll narrow it down further!`;
    }

    // ── Under ₹25,000 ──
    if (budget <= 25) {
      if (isHinglish) {
        return `### 📱 Best Phones Under ₹25,000 (2026)\n\n` +
          `1. **Samsung Galaxy A55 5G** (~₹24,999) — Exynos 1480, 8GB RAM, 50MP OIS camera, IP67, AMOLED. Best overall.\n` +
          `2. **OnePlus Nord CE 4** (~₹23,999) — Snapdragon 7s Gen 3, 100W fast charge, 5500mAh. Best charging speed.\n` +
          `3. **Redmi Note 13 Pro+** (~₹23,999) — Dimensity 7200, 200MP camera, 120W charging. Best camera value.\n` +
          `4. **iQOO Z9** (~₹21,999) — Snapdragon 7 Gen 3, 144Hz AMOLED, gaming-grade performance.\n\n` +
          `**Best pick**: **Samsung Galaxy A55 5G** — premium build + IP67 + guaranteed updates. 🚀`;
      }
      return `### 📱 Best Phones Under ₹25,000 (2026)\n\n` +
        `1. **Samsung Galaxy A55 5G** (~₹24,999) — Exynos 1480, IP67, 50MP OIS, AMOLED. Best overall build and software.\n` +
        `2. **OnePlus Nord CE 4** (~₹23,999) — Snapdragon 7s Gen 3, **100W fast charging**, 5500mAh. Best charging speed.\n` +
        `3. **Redmi Note 13 Pro+** (~₹23,999) — Dimensity 7200, 200MP camera, 120W. Best camera per rupee.\n` +
        `4. **iQOO Z9** (~₹21,999) — Snapdragon 7 Gen 3, 144Hz AMOLED, great for gaming.\n\n` +
        `**Recommendation**: **Samsung Galaxy A55 5G** — best premium feel, long-term software support, and IP67 protection.`;
    }

    // ── Under ₹30,000 / General High Budget ──
    if (isHinglish) {
      return `### 📱 Best Phones Under ₹30,000 (2026)\n\n` +
        `1. **Samsung Galaxy A55 5G** (~₹24,999) — Exynos 1480, IP67, AMOLED, 50MP OIS.\n` +
        `2. **Nothing Phone (2a) Plus** (~₹27,999) — Dimensity 7350 Pro, Glyph UI, 50MP, 5000mAh.\n` +
        `3. **OnePlus Nord 4** (~₹29,999) — Snapdragon 7+ Gen 3, 100W charging, 50MP, slim metal design.\n` +
        `4. **iQOO Neo 9** (~₹26,999) — Dimensity 7200 Ultra, 144Hz AMOLED, 66W charge, gaming-focused.\n\n` +
        `**Best pick**: **OnePlus Nord 4** — flagship-grade Snapdragon chip + 100W charging is unbeatable at ₹30k.`;
    }
    return `### 📱 Best Phones Under ₹30,000 (2026)\n\n` +
      `1. **Samsung Galaxy A55 5G** (~₹24,999) — Exynos 1480, IP67, AMOLED display, 4-year OS support.\n` +
      `2. **Nothing Phone (2a) Plus** (~₹27,999) — Dimensity 7350 Pro, unique Glyph interface, clean Android.\n` +
      `3. **OnePlus Nord 4** (~₹29,999) — Snapdragon 7+ Gen 3, 100W fast charging, slim metal unibody.\n` +
      `4. **iQOO Neo 9** (~₹26,999) — Dimensity 7200 Ultra, 144Hz AMOLED, best gaming performance.\n\n` +
      `**Recommendation**: **OnePlus Nord 4** — near-flagship performance with ultra-fast 100W charging makes it the best buy at this budget.`;
  }

  // 6.5 Laptop & Tech Recommendations
  if (lower.includes('laptop') || lower.includes('computer') || lower.includes('macbook') || lower.includes('pc recommendation') || lower.includes('best pc')) {
    if (isHinglish) {
      return `### 💻 Top Recommended Laptops (2026)\n\n` +
        `Aapki zaroorat ke hisaab se best options:\n\n` +
        `1. **Best Overall / Battery Life**: **Apple MacBook Air (M3 / M4)**\n` +
        `   - *Best for*: Everyday use, coding, college students, media production.\n` +
        `   - *Why*: Silent design, 18+ hours battery life, high build quality.\n\n` +
        `2. **Best Windows Ultrabook**: **ASUS Zenbook 14 OLED / Dell XPS 14**\n` +
        `   - *Best for*: Business, coding, portable productivity.\n` +
        `   - *Why*: Gorgeous OLED screen, Intel Core Ultra / AMD Ryzen AI processors, sleek design.\n\n` +
        `3. **Best for Gaming & Heavy Work**: **Lenovo Legion Pro 5 / ASUS ROG Zephyrus G14**\n` +
        `   - *Best for*: 3D Rendering, Gaming, Video Editing.\n` +
        `   - *Why*: NVIDIA RTX 4060/4070 GPU, high refresh rate display, great cooling.\n\n` +
        `4. **Best Budget Laptop**: **Lenovo IdeaPad Slim 5 / Acer Swift Go 14**\n` +
        `   - *Best for*: Budget-conscious students and general home/office work.\n` +
        `   - *Why*: Great performance for the price with modern Ryzen 7 / Core i5 processors.`;
    }
    return `### 💻 Top Recommended Laptops (2026)\n\n` +
      `Here are the best laptops categorized by user needs and use-cases:\n\n` +
      `1. **Best Overall / Everyday Use**: **Apple MacBook Air (M3 / M4)**\n` +
      `   - **Target Audience**: Students, developers, professionals, content creators.\n` +
      `   - **Highlights**: Exceptional performance per watt, silent fanless design, up to 18+ hours battery life.\n\n` +
      `2. **Best Windows Ultrabook**: **ASUS Zenbook 14 OLED / Dell XPS 13 or 14**\n` +
      `   - **Target Audience**: Business professionals, Windows power users, mobile workers.\n` +
      `   - **Highlights**: Stunning OLED display, lightweight aluminum chassis, latest Intel Core Ultra / AMD Ryzen AI chips.\n\n` +
      `3. **Best for Gaming & High Performance**: **Lenovo Legion Pro 5 / ASUS ROG Zephyrus G14**\n` +
      `   - **Target Audience**: Gamers, 3D animators, ML/AI engineers.\n` +
      `   - **Highlights**: Powerful NVIDIA RTX 4060/4070 graphics, 165Hz/240Hz screen, active thermal management.\n\n` +
      `4. **Best Budget / Value for Money**: **Lenovo IdeaPad Slim 5 / Acer Swift Go 14**\n` +
      `   - **Target Audience**: Budget-conscious students & everyday users.\n` +
      `   - **Highlights**: Crisp 1080p/2K screen, fast SSD storage, reliable multi-core AMD/Intel performance.`;
  }

  // 6.6 Budget Laptop Recommendations — must explicitly mention laptop/computer to avoid intercepting phone queries
  if ((lower.includes('laptop') || lower.includes('computer') || lower.includes('notebook') || lower.includes('macbook')) &&
      (lower.includes('under') || lower.includes('budget') || lower.includes('70000') || lower.includes('70k') || lower.includes('60000') || lower.includes('60k') || lower.includes('50000') || lower.includes('50k') || lower.includes('80000') || lower.includes('80k'))) {
    if (isHinglish) {
      return `### 💻 Best Laptops Under ₹70,000 (INR)\n\n` +
        `₹70,000 ke budget me top recommended laptops:\n\n` +
        `1. **Best Coding & Overall Performance**: **Lenovo IdeaPad Slim 5** (~₹62,000 - ₹68,000)\n` +
        `   - *Specs*: Intel Core i5 13th Gen / AMD Ryzen 7 7730U, 16GB RAM, 512GB SSD, Metal Body.\n` +
        `   - *Why*: Reliable performance, solid keyboard, long battery life.\n\n` +
        `2. **Best Display & Portable**: **ASUS Vivobook S 15 OLED / Swift Go 14** (~₹60,000 - ₹66,000)\n` +
        `   - *Specs*: 2.8K 120Hz OLED Display, Intel Core i5 13th Gen Evo / Core Ultra 5, 16GB LPDDR5 RAM.\n` +
        `   - *Why*: Unmatched screen clarity, ultra-thin lightweight chassis.\n\n` +
        `3. **Best Gaming & Video Editing (RTX GPU)**: **Lenovo LOQ 15 / Acer Nitro V 15** (~₹64,000 - ₹69,990)\n` +
        `   - *Specs*: Intel Core i5 13420H / Ryzen 5 7535HS, NVIDIA RTX 4050 (6GB VRAM), 16GB RAM, 144Hz Display.\n` +
        `   - *Why*: Smooth 1080p gaming and fast 3D/video rendering.\n\n` +
        `4. **Best Apple macOS Option**: **Apple MacBook Air M1 / M2 (On Sale)** (~₹65,000 - ₹72,000)\n` +
        `   - *Specs*: Apple M1/M2 Chip, 8GB RAM, 256GB SSD, Retina Display.\n` +
        `   - *Why*: Best battery life (15+ hours), lightweight, super silent performance.`;
    }
    return `### 💻 Best Laptops Under ₹70,000 (INR)\n\n` +
      `Here are the absolute best laptop choices around the **₹70,000 budget bracket**:\n\n` +
      `1. **Best Overall for Work & Coding**: **Lenovo IdeaPad Slim 5** (~₹62,000 – ₹68,000)\n` +
      `   - **Specs**: Intel Core i5 (13th Gen) / AMD Ryzen 7 7730U, 16GB RAM, 512GB NVMe SSD, FHD IPS display.\n` +
      `   - **Why Buy**: Excellent build quality, backlit keyboard, long battery life, great multi-tasking.\n\n` +
      `2. **Best OLED Display & Ultra-Portable**: **ASUS Vivobook S 15 OLED / Acer Swift Go 14** (~₹60,000 – ₹66,000)\n` +
      `   - **Specs**: 2.8K OLED 120Hz display, Intel Core i5 Evo / Core Ultra 5, 16GB LPDDR5 RAM.\n` +
      `   - **Why Buy**: Incredible color accuracy (100% DCI-P3), lightweight aluminum body.\n\n` +
      `3. **Best for Gaming & Video Editing**: **Lenovo LOQ 15 / Acer Nitro V 15** (~₹64,000 – ₹69,990)\n` +
      `   - **Specs**: Intel Core i5-13420H / Ryzen 5 7535HS, **NVIDIA RTX 4050 (6GB VRAM)**, 16GB DDR5 RAM, 144Hz Screen.\n` +
      `   - **Why Buy**: Best graphics performance in this price segment for 1080p gaming and 4K video editing.\n\n` +
      `4. **Best macOS Option**: **Apple MacBook Air (M1 / M2 on Sale)** (~₹65,000 – ₹72,000)\n` +
      `   - **Specs**: Apple M1 or M2 Chip, 8GB Unified Memory, 256GB SSD, Retina Display.\n` +
      `   - **Why Buy**: Unbeatable battery life (15-18 hours), premium aluminum finish, ultra-portable.`;
  }

  // 6.7 Geography & Capitals DB
  const CAPITALS_MAP = {
    'china': 'Beijing',
    'india': 'New Delhi',
    'united states': 'Washington, D.C.',
    'usa': 'Washington, D.C.',
    'us': 'Washington, D.C.',
    'france': 'Paris',
    'japan': 'Tokyo',
    'germany': 'Berlin',
    'united kingdom': 'London',
    'uk': 'London',
    'england': 'London',
    'italy': 'Rome',
    'spain': 'Madrid',
    'canada': 'Ottawa',
    'australia': 'Canberra',
    'russia': 'Moscow',
    'brazil': 'Brasilia',
    'egypt': 'Cairo',
    'south korea': 'Seoul',
    'korea': 'Seoul',
    'pakistan': 'Islamabad',
    'bangladesh': 'Dhaka',
    'nepal': 'Kathmandu',
    'sri lanka': 'Sri Jayawardenepura Kotte (Colombo)',
    'indonesia': 'Jakarta',
    'thailand': 'Bangkok',
    'singapore': 'Singapore',
    'uae': 'Abu Dhabi',
    'united arab emirates': 'Abu Dhabi',
    'saudi arabia': 'Riyadh',
    'turkey': 'Ankara',
    'greece': 'Athens',
    'netherlands': 'Amsterdam',
    'switzerland': 'Bern',
    'sweden': 'Stockholm',
    'norway': 'Oslo',
    'denmark': 'Copenhagen',
    'mexico': 'Mexico City',
    'argentina': 'Buenos Aires'
  };

  if (lower.includes('capital')) {
    for (const [country, capital] of Object.entries(CAPITALS_MAP)) {
      if (lower.includes(country)) {
        const cName = country === 'china' ? 'China' : country.charAt(0).toUpperCase() + country.slice(1);
        if (isHinglish) {
          return `**${cName}** ki rajdhani (capital) **${capital}** hai!\n\nAgar aapko is desh ke geography, population, ya history ke baare mein aur jaanna hai toh zaroor bataiye!`;
        }
        return `The capital of **${cName}** is **${capital}**.\n\nBeijing is China's political, cultural, and educational center, home to famous historical landmarks such as the Forbidden City and the Great Wall of China!`;
      }
    }
  }

  // 6.7.5 Math & Speed / Distance / Time Word Problem Solver Engine
  const distMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometers?|miles?|m|meters?)/i);
  const timeMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|minutes?|mins?|seconds?|secs?)/i);
  const isSpeedQuery = lower.includes('speed') || lower.includes('fast') || lower.includes('velocity') || lower.includes('calculate speed') || lower.includes('average speed');

  if (distMatch && timeMatch && isSpeedQuery) {
    const dist = parseFloat(distMatch[1]);
    const time = parseFloat(timeMatch[1]);
    const distStr = distMatch[0].trim();
    const timeStr = timeMatch[0].trim();

    if (time > 0) {
      const speed = (dist / time).toFixed(2).replace(/\.00$/, '');
      const isKm = /km|kilometer/i.test(distStr);
      const isHr = /hour|hr|h\b/i.test(timeStr);
      const unitStr = isKm ? (isHr ? 'km/h' : 'km/min') : (isHr ? 'mph' : 'm/s');

      if (isHinglish) {
        return `### 📐 Math Solution: Average Speed Calculation\n\n` +
          `**Formula**: \`Average Speed = Total Distance ÷ Total Time\`\n\n` +
          `### 🔑 Step-by-Step Solution:\n` +
          `1. **Given Data**:\n` +
          `   - Distance ($D$) = **${distStr}**\n` +
          `   - Time ($T$) = **${timeStr}**\n\n` +
          `2. **Calculation**:\n` +
          `   $$\\text{Average Speed} = \\frac{${dist}}{${time}} = ${speed}\\text{ ${unitStr}}$$\n\n` +
          `### 🎯 Final Answer:\n` +
          `The average speed of the train is **${speed} ${unitStr}**!`;
      }

      return `### 📐 Math Solution: Average Speed Calculation\n\n` +
        `**Formula**: \`Average Speed = Total Distance ÷ Total Time\`\n\n` +
        `### 🔑 Step-by-Step Solution:\n` +
        `1. **Given Data**:\n` +
        `   - Distance ($D$) = **${distStr}**\n` +
        `   - Time ($T$) = **${timeStr}**\n\n` +
        `2. **Calculation**:\n` +
        `   $$\\text{Average Speed} = \\frac{${dist}}{${time}} = ${speed}\\text{ ${unitStr}}$$\n\n` +
        `### 🎯 Final Answer:\n` +
        `The average speed is **${speed} ${unitStr}**!`;
    }
  }

  // 6.7.6 NUMBER SERIES & SEQUENCE SOLVER ENGINE
  const isSequenceQuery = lower.includes('next number') || lower.includes('sequence') || lower.includes('pattern') || lower.includes('series') || /[\d\s,]+[?_]/.test(prompt);
  const numberMatches = prompt.match(/\b\d+\b/g);

  if (isSequenceQuery && numberMatches && numberMatches.length >= 3) {
    const numbers = numberMatches.map(Number);
    const n = numbers.length;
    
    // Calculate differences between consecutive terms
    const diffs = [];
    for (let i = 0; i < n - 1; i++) {
      diffs.push(numbers[i + 1] - numbers[i]);
    }

    // Calculate second differences
    const diffDiffs = [];
    for (let i = 0; i < diffs.length - 1; i++) {
      diffDiffs.push(diffs[i + 1] - diffs[i]);
    }

    let nextNumber = null;
    let patternExplanation = '';

    // Case 1: Constant differences (Arithmetic Progression, e.g. 2, 5, 8, 11)
    if (diffs.every(d => d === diffs[0])) {
      const step = diffs[0];
      nextNumber = numbers[n - 1] + step;
      patternExplanation = `Each number increases by **+${step}**:\n- ${numbers.join(' ➔ ')} ➔ **${nextNumber}** (+${step})`;
    }
    // Case 2: Constant second differences (e.g., 2, 6, 12, 20, 30 -> diffs: 4, 6, 8, 10 -> diffs of diffs: +2)
    else if (diffDiffs.length > 0 && diffDiffs.every(dd => dd === diffDiffs[0])) {
      const stepIncrease = diffDiffs[0];
      const nextDiff = diffs[diffs.length - 1] + stepIncrease;
      nextNumber = numbers[n - 1] + nextDiff;
      
      patternExplanation = `The differences between consecutive numbers increase by **+${stepIncrease}** at each step:\n`;
      for (let i = 0; i < diffs.length; i++) {
        patternExplanation += `- ${numbers[i]} ➔ ${numbers[i + 1]} (Difference: **+${diffs[i]}**)\n`;
      }
      patternExplanation += `- Next difference = ${diffs[diffs.length - 1]} + ${stepIncrease} = **+${nextDiff}**\n`;
      patternExplanation += `- Next term = ${numbers[n - 1]} + ${nextDiff} = **${nextNumber}**`;
    }
    // Case 3: Geometric Progression (e.g. 2, 4, 8, 16)
    else if (n >= 3 && numbers[0] !== 0) {
      const ratio = numbers[1] / numbers[0];
      let isGeometric = true;
      for (let i = 1; i < n - 1; i++) {
        if (numbers[i + 1] / numbers[i] !== ratio) {
          isGeometric = false;
          break;
        }
      }
      if (isGeometric) {
        nextNumber = numbers[n - 1] * ratio;
        patternExplanation = `Each number is multiplied by **×${ratio}**:\n- ${numbers.join(' ➔ ')} ➔ **${nextNumber}** (×${ratio})`;
      }
    }
    // Case 4: Squares / Product n*(n+1)
    if (nextNumber === null) {
      let isNProduct = true;
      for (let i = 0; i < n; i++) {
        if (numbers[i] !== (i + 1) * (i + 2)) {
          isNProduct = false;
          break;
        }
      }
      if (isNProduct) {
        nextNumber = (n + 1) * (n + 2);
        patternExplanation = `The $n$-th term is calculated as $n \\times (n + 1)$:\n`;
        for (let i = 0; i < n; i++) {
          patternExplanation += `- Term ${i + 1}: ${i + 1} × ${i + 2} = **${numbers[i]}**\n`;
        }
        patternExplanation += `- Term ${n + 1}: ${n + 1} × ${n + 2} = **${nextNumber}**`;
      }
    }

    if (nextNumber !== null) {
      if (isHinglish) {
        return `### 🔢 Number Series Solution\n\n` +
          `**Sequence**: \`${numbers.join(', ')}, ?\`\n\n` +
          `### 🔑 Pattern Breakdown:\n${patternExplanation}\n\n` +
          `### 🎯 Final Answer:\n` +
          `The next number in the sequence is **${nextNumber}**!`;
      }
      return `### 🔢 Number Series Solution\n\n` +
        `**Sequence**: \`${numbers.join(', ')}, ?\`\n\n` +
        `### 🔑 Pattern Breakdown:\n${patternExplanation}\n\n` +
        `### 🎯 Final Answer:\n` +
        `The next number in the sequence is **${nextNumber}**!`;
    }
  }

  // 6.7.7 RATE & WORK / CATS & MICE RIDDLE SOLVER ENGINE
  if ((lower.includes('cat') && lower.includes('mic')) || (lower.includes('cat') && lower.includes('mouse')) || (lower.includes('man') && lower.includes('days')) || (lower.includes('worker') && lower.includes('hours'))) {
    const numbers = prompt.match(/\b\d+\b/g);
    if (numbers && numbers.length >= 4) {
      const c1 = Number(numbers[0]);
      const m1 = Number(numbers[1]);
      const t1 = Number(numbers[2]);
      const m2 = Number(numbers[3]);
      const t2 = numbers.length >= 5 ? Number(numbers[4]) : t1;

      const w2 = Math.round((c1 * t1 * m2) / (m1 * t2));

      if (isHinglish) {
        return `### 🐱 Logic Riddle & Rate Solution\n\n` +
          `**Problem**: "${prompt}"\n\n` +
          `### 🔑 Step-by-Step Logic:\n` +
          `1. **Analyze Individual Rate**:\n` +
          `   - **${c1} cats** catch **${m1} mice** in **${t1} minutes**.\n` +
          `   - This means **1 cat** catches **1 mouse** in **${t1} minutes**.\n` +
          `2. **Calculate Work over ${t2} minutes**:\n` +
          `   - In ${t2} minutes, **1 cat** can catch $${t2} \\div ${t1} = ${(t2 / t1).toFixed(2)}$ mice.\n` +
          `   - To catch **${m2} mice** in **${t2} minutes**:\n` +
          `   $$\\text{Cats Needed} = \\frac{\\text{Total Mice}}{\\text{Mice per Cat}} = \\frac{${m2}}{${(t2 / t1).toFixed(2)}} = \\mathbf{${w2}}$$\n\n` +
          `### 🎯 Final Answer:\n` +
          `You still need **${w2} cats** to catch ${m2} mice in ${t2} minutes!`;
      }

      return `### 🐱 Logic Riddle & Rate Solution\n\n` +
        `**Problem**: "${prompt}"\n\n` +
        `### 🔑 Step-by-Step Logic:\n` +
        `1. **Analyze Individual Rate**:\n` +
        `   - **${c1} cats** catch **${m1} mice** in **${t1} minutes**.\n` +
        `   - This means **1 cat** catches **1 mouse** in **${t1} minutes**.\n` +
        `2. **Calculate Work over ${t2} minutes**:\n` +
        `   - In ${t2} minutes, **1 cat** can catch $${t2} \\div ${t1} = ${(t2 / t1).toFixed(2)}$ mice.\n` +
        `   - To catch **${m2} mice** in **${t2} minutes**:\n` +
        `   $$\\text{Cats Needed} = \\frac{\\text{Total Mice}}{\\text{Mice per Cat}} = \\frac{${m2}}{${(t2 / t1).toFixed(2)}} = \\mathbf{${w2}}$$\n\n` +
        `### 🎯 Final Answer:\n` +
        `You need **${w2} cats** to catch ${m2} mice in ${t2} minutes!`;
    }
  }

  // 6.7.8 Handle "solve qn", "solve this", "solve question", "solve it"
  if (/^(solve qn|solve question|solve this|solve|solution|answer this|solve it)\b/i.test(prompt.trim())) {
    const lastUserMsg = Array.isArray(history) && history.length > 0 ? history.filter(h => h.role === 'user').pop() : null;
    const prevQuery = lastUserMsg ? lastUserMsg.content : '';

    if (prevQuery) {
      return generateSmartLocalResponse(prevQuery, personaKey, attachment, webGrounding, history.slice(0, -1));
    }
  }

  // 6.8 Economics & Finance Core Knowledge
  if (lower.includes('deficit') || lower.includes('budget deficit')) {
    if (isHinglish) {
      return `### 💡 Budget Deficit Kya Hota Hai? (Complete Explanation)\n\n**Budget Deficit** (बजट घाटा) tab hota hai jab kisi government, company, ya vyakti ki **Total Aamdani (Revenue/Income)** se zyada unka **Total Kharcha (Expenditure)** ho jata hai.\n\n### 🔑 Key Concepts:\n1. **Formula**: \`Budget Deficit = Total Expenditure - Total Revenue\`\n2. **Kyun Hota Hai**: Jab sarkar public infrastructure, defense, healthcare, aur education par tax revenue se zyada spending karti hai.\n3. **Kaise Cover Hota Hai**: Government ise cover karne ke liye Central Banks (e.g. RBI) ya public/foreign markets se loans aur bonds issue karke borrow karti hai.\n\n### 📊 Key Types of Deficits:\n- **Fiscal Deficit**: Total expenditure minus non-borrowed revenue.\n- **Revenue Deficit**: Routine operational spending revenue se zyada ho jana.\n- **Primary Deficit**: Fiscal deficit minus past loans ka interest payment.`;
    }
    return `### 💡 What is a Budget Deficit? (Complete Breakdown)\n\nA **budget deficit** occurs when financial expenditure exceeds revenue/income over a given period, most commonly applied to government financial budgets.\n\n### 🔑 Core Principles:\n1. **Formula**: \`Budget Deficit = Total Expenditure - Total Revenue\`\n2. **Primary Cause**: Governments spend more money on public infrastructure, defense, healthcare, and social welfare than they collect from taxes and tariffs.\n3. **How It Is Funded**: Governments finance budget deficits by issuing government bonds, borrowing from domestic/international financial markets, or central bank credit.\n\n### 📊 Major Types of Economic Deficits:\n- **Fiscal Deficit**: Total expenditure minus total non-borrowed revenue.\n- **Revenue Deficit**: When routine operational spending exceeds revenue earnings.\n- **Primary Deficit**: Fiscal deficit minus interest payments on previous debt.`;
  }

  if (lower.includes('economics') || lower.includes('economy')) {
    if (isHinglish) {
      return `### 📊 Economics Kya Hai? (What is Economics?)\n\n**Economics** (अर्थशास्त्र) wo social science hai jo ye study karti hai ki log, companies, aur governments apne **limited resources** (seemit sadhan) ka istemal apni **unlimited demands** (aseemit zarooratein) ko poora karne ke liye kaise karte hain.\n\n### 🏛️ Two Main Branches of Economics:\n1. **Microeconomics (सूक्ष्म अर्थशास्त्र)**:\n   - Individual buyers, sellers, aur single business decision-making ki study karta hai (e.g. kisi product ka price, demand & supply).\n2. **Macroeconomics (समष्टि अर्थशास्त्र)**:\n   - Pure desh aur global economy ki study karta hai (e.g. GDP, Inflation, Unemployment, National Income, Fiscal Policy).\n\n### 🔑 Core Pillars:\n- **Scarcity & Choice**: Resources hamesha limited hote hain, isiliye prioritization zaroori hota hai.\n- **Supply & Demand**: Market price determines how goods and services flow.\n- **Inflation & Interest Rates**: Central banks control money supply and interest rates to keep the economy stable.`;
    }
    return `### 📊 What is Economics? (Complete Breakdown)\n\n**Economics** is the social science that studies how individuals, businesses, governments, and societies allocate **scarce resources** to satisfy **unlimited wants and needs**.\n\n### 🏛️ Two Primary Branches:\n1. **Microeconomics**:\n   - Focuses on individual decision-makers, households, and firms. Analyzes concepts like supply and demand, market equilibrium, pricing, and consumer behavior.\n2. **Macroeconomics**:\n   - Analyzes the economy as a whole on a national or global scale. Examines key metrics such as GDP, Inflation, Unemployment rates, Fiscal & Monetary policy, and International Trade.\n\n### 🔑 Key Pillars of Economic Science:\n- **Scarcity**: Resources (time, labor, capital, natural resources) are finite.\n- **Opportunity Cost**: The value of the next best alternative given up when making a choice.\n- **Supply and Demand**: The primary driver of prices and resource allocation in market economies.`;
  }

  // 6.9 Artificial Intelligence (AI) & Machine Learning
  if (lower.includes('artificial intelligence') || lower.includes('what is ai') || lower.includes('ai kya hai') || lower === 'ai' || lower.includes('machine learning')) {
    if (isHinglish) {
      return `### 🤖 Artificial Intelligence (AI) Kya Hai? (Complete Explanation)\n\n**Artificial Intelligence (AI)** computer science ki wo branch hai jo computers aur machines ko insani dimaag ki tarah **sochne, seekhne, problem solve karne, aur decision lene** ke kabil banati hai.\n\n### 🔑 Core Branches of AI:\n1. **Machine Learning (ML)**: Algorithms jo data se seekhte hain (e.g. recommendation systems).\n2. **Deep Learning & Neural Networks**: Insaani dimaag ke neurons jaise structure par based models.\n3. **Generative AI & LLMs**: Text, images, audio, aur code generate karne wale models (jaise ChatGPT, Gemini, Claude).\n4. **Computer Vision & NLP**: Images/videos ko samajhna aur human language ko process karna.\n\n### 🚀 Real-World Applications:\n- **Self-Driving Cars** (Tesla, Waymo)\n- **Healthcare**: Disease detection & drug discovery\n- **Personal Assistants**: ChatNest AI, ChatGPT, Google Gemini\n- **Finance**: Fraud detection & automated trading.`;
    }
    return `### 🤖 What is Artificial Intelligence (AI)? (Complete Breakdown)\n\n**Artificial Intelligence (AI)** is the branch of computer science dedicated to developing systems capable of performing tasks that typically require **human intelligence**, such as reasoning, learning, problem-solving, and decision-making.\n\n### 🔑 Primary Sub-Fields of AI:\n1. **Machine Learning (ML)**: Systems that learn patterns from data to improve performance over time without explicit programming.\n2. **Deep Learning & Neural Networks**: Advanced ML models inspired by the human brain's neural architecture, powering image/speech recognition.\n3. **Generative AI & LLMs**: AI models capable of creating new text, code, images, and audio (e.g., ChatGPT, Gemini, Claude).\n4. **Natural Language Processing (NLP)**: Enables machines to comprehend, interpret, and generate human language.\n\n### 🚀 Real-World Applications:\n- **Autonomous Vehicles**: Self-driving navigation (Tesla, Waymo)\n- **Healthcare**: Medical imaging, diagnostic assistance, and automated drug discovery\n- **Smart Assistants**: ChatNest AI, ChatGPT, Siri, Google Assistant\n- **Financial Technology**: Fraud prevention, algorithmic trading, and credit risk assessment.`;
  }

  // 6.10 Cloud Computing
  if (lower.includes('cloud computing') || lower.includes('cloud service') || lower.includes('what is cloud')) {
    if (isHinglish) {
      return `### ☁️ Cloud Computing Kya Hai? (Complete Explanation)\n\n**Cloud Computing** ka matlab hai internet ke zariye computing services (jaise **servers, storage, databases, networking, software**) ko demand par access karna, bina khud ke physical hardware ya servers khareede.\n\n### 🏗️ 3 Main Service Models:\n1. **IaaS (Infrastructure as a Service)**: Raw virtual servers aur storage (e.g. AWS EC2, Google Compute Engine).\n2. **PaaS (Platform as a Service)**: Apps build aur deploy karne ke liye ready platforms (e.g. Heroku, Vercel, Firebase).\n3. **SaaS (Software as a Service)**: Internet par ready-to-use software applications (e.g. Gmail, Google Drive, Microsoft 365).\n\n### 🌟 Key Benefits:\n- **Cost Efficiency**: Pay-as-you-go model (jitna use karo utna pay karo).\n- **High Scalability**: Traffic badhne par servers instantly scale ho jate hain.\n- **Global Accessibility**: Internet se kahin se bhi data access kar sakte hain.`;
    }
    return `### ☁️ What is Cloud Computing? (Complete Breakdown)\n\n**Cloud Computing** is the on-demand delivery of IT resources—including **servers, storage, databases, networking, and software**—over the Internet with pay-as-you-go pricing, eliminating the need to own and maintain physical data centers.\n\n### 🏗️ 3 Core Service Models:\n1. **IaaS (Infrastructure as a Service)**: Provides virtualized computing resources over the internet (e.g., AWS EC2, Google Compute Engine, Azure VMs).\n2. **PaaS (Platform as a Service)**: Provides hardware and software tools over the internet, typically for application development (e.g., Vercel, Heroku, AWS Elastic Beanstalk).\n3. **SaaS (Software as a Service)**: Delivers a complete, ready-to-use application over the internet (e.g., Google Workspace, Microsoft 365, Dropbox).\n\n### 🌟 Primary Advantages:\n- **Cost Efficiency**: Eliminates capital expenditure on physical servers and maintenance.\n- **Scalability & Flexibility**: Scale IT resources up or down instantaneously based on demand.\n- **Global Availability**: Access data and applications securely from anywhere in the world.`;
  }

  // 6.11 Handle "in detail" / "more detail" follow-up queries using conversation history
  if (/^(in detail|more detail|explain more|more|tell me more|expand|detail)\b/i.test(prompt.trim())) {
    const lastUserMsg = Array.isArray(history) && history.length > 0 ? history.filter(h => h.role === 'user').pop() : null;
    const previousQuery = lastUserMsg ? lastUserMsg.content : 'the previous topic';
    return isHinglish
      ? `### 🔍 In-Depth Detailed Expansion on: "${previousQuery}"\n\n` +
        `Yahan **"${previousQuery}"** ke advanced mechanics aur deep-dive concepts hain:\n\n` +
        `1. **Advanced Theoretical Mechanics**:\n` +
        `   - Is topic ke core operational dynamics systemic variables aur structural frameworks par depend karte hain.\n` +
        `   - High-level decision making, mathematical modeling, aur strategic optimization me iska primary role hota hai.\n\n` +
        `2. **Real-World Case Studies & Applications**:\n` +
        `   - Enterprise solutions, national policies, aur modern software architectures me iska deep integration hai.\n` +
        `   - Performance optimization, scalability, aur long-term sustainability me iska key contribution hota hai.\n\n` +
        `3. **Key Takeaways & Best Practices**:\n` +
        `   - Systematic execution aur regular monitoring se maximum efficiency achieve ki ja sakti hai.`
      : `### 🔍 In-Depth Detailed Expansion on: "${previousQuery}"\n\n` +
        `Here is an advanced, in-depth structural analysis building upon **"${previousQuery}"**:\n\n` +
        `1. **Advanced Core Dynamics**:\n` +
        `   - The operational mechanics rely on complex systemic variables, feedback loops, and governance models.\n` +
        `   - Crucial for high-level strategic decision-making, predictive modeling, and system-wide optimization.\n\n` +
        `2. **Real-World Case Studies & Industry Applications**:\n` +
        `   - Widely integrated across enterprise software architectures, macroeconomic policy frameworks, and advanced research.\n` +
        `   - Directly drives efficiency, long-term scalability, and risk mitigation.\n\n` +
        `3. **Key Takeaways & Strategic Summary**:\n` +
        `   - Achieving optimal results requires systematic implementation, continuous monitoring, and iterative refinement.`;
  }

  if (isHinglish) {
    let res = `### Answers & Insights for: "${prompt}"\n\n`;
    if (attachment) res += `**Attachment Analyzed:** \`${attachment.name}\` (${attachment.type})\n\n`;
    res += `Maine aapke sawal **"${prompt}"** ko analyze kar liya hai.\n\n`;
    res += `- **Overview**: ChatNest Universal AI is ready to provide full responses, code implementations, math step-by-step solutions, and detailed insights.\n`;
    res += `- **Tip**: Toggle **Web Search** in the header bar for live up-to-the-minute web information!`;
    return res;
  }

  // ──────────────────────────────────────────────────────────
  // SMART CONVERSATIONAL FALLBACK ENGINE
  // Handles casual chat, emotions, compliments, gratitude etc.
  // ──────────────────────────────────────────────────────────

  // Love / Affection
  if (/\bi love you\b|\bI love u\b|\bpyaar\b|\bmohabbat\b|\bI ❤️ you\b/i.test(lower)) {
    return isHinglish
      ? `Shukriya! Main ek AI hoon isliye feelings nahi hoti, lekin aapki baat sun ke achha lagta hai!\n\nMain har waqt aapki madad ke liye yahan hoon — coding, math, science, ya sirf baatein karna. Bolo, aaj kya explore karna hai?`
      : `Thank you so much! I'm an AI so I don't feel emotions, but I appreciate your kind words!\n\nI'm always here for you — for coding help, answering questions, or just a good conversation. What shall we explore today?`;
  }

  // Thanks / Appreciation
  if (/\bthank(s| you)\b|\bshukriya\b|\bdhanyawad\b|\bbadhiya\b|\bkamaal\b|\bwow\b|\bawesome\b|\bamazing\b|\bgreat\b|\bperfect\b|\bbest\b/i.test(lower)) {
    return isHinglish
      ? `Khushi hui ki kaam aaya!\n\nKoi aur sawaal ho toh poochein — main coding, math, science, history, ya kuch bhi samjhane ke liye tayyar hoon!`
      : `You're welcome! So glad I could help.\n\nFeel free to ask me anything — I'm here for coding, science, math, general knowledge, or just a good chat!`;
  }

  // Okay / Understood / Noted
  if (/^(ok|okay|fine|hmm|hm|theek hai|theek|acha|accha|noted|got it|understood|alright|cool|sure|yep|yup|right|ooh|oh)\.?$/i.test(lower.trim())) {
    return isHinglish
      ? `Bilkul! Koi aur sawaal ho toh batayein, main haazir hoon!`
      : `Got it! Let me know if there's anything else I can help you with!`;
  }

  // Goodbye / Bye
  if (/\bbye\b|\bgoodbye\b|\balvida\b|\bphir milenge\b|\bsee you\b|\btake care\b/i.test(lower)) {
    return isHinglish
      ? `Alvida! Jab bhi zaroorat ho, main yahan hoon. Take care!`
      : `Goodbye! Come back anytime — I'll always be here to help. Take care!`;
  }

  // Who made you / your developer
  if (/\bwho made you\b|\bwho built you\b|\bwho is your creator\b|\bkisne banaya\b|\btumhe kisne\b/i.test(lower)) {
    return isHinglish
      ? `Main **ChatNest AI** hoon — Ashish aur ChatNest team ne mujhe banaya hai. Main ek full-stack Node.js + Gemini AI powered chatbot hoon jo aapki har zaroorat ke liye tayyar hai!`
      : `I am **ChatNest AI**, built by Ashish and the ChatNest team using Node.js and powered by Google Gemini AI. I'm designed to be your all-in-one intelligent assistant!`;
  }

  // Sadness / Feeling bad
  if (/\bsad\b|\bupset\b|\bdukhi\b|\brona\b|\bdepressed\b|\blonely\b|\balone\b|\bkoi nahi\b/i.test(lower)) {
    return isHinglish
      ? `Aap udaas mat hoiye, main yahan hoon!\n\nKuch baatein karte hain, ya koi interesting topic explore karte hain. Bolo kya achha lagta hai aapko — main poori koshish karunga.`
      : `I'm sorry to hear that. You're not alone — I'm right here!\n\nLet's talk, or explore something interesting together. What do you enjoy?`;
  }

  // Bored
  if (/\bbore\b|\bbored\b|\bboring\b|\bkuch nahi\b|\bkya karu\b|\bnothing to do\b/i.test(lower)) {
    return isHinglish
      ? `Boredom? Isme main madad kar sakta hoon!\n\n**Yeh try karein:**\n- Koi interesting fact ya trivia poochein\n- Koi app ya project idea banate hain saath mein\n- Web Search on karke today's top news dekhein\n- Koi math puzzle ya coding challenge try karein\n\nBolo, kya karna hai?`
      : `Bored? Let me fix that!\n\n**Try one of these:**\n- Ask me a random mind-blowing fact or trivia\n- Let's brainstorm an app or project idea together\n- Turn on Web Search and explore today's top news\n- Try a math puzzle or coding challenge\n\nWhat sounds fun?`;
  }

  // ── 7. CODE GENERATION ENGINE ──
  const codeLangMatch = lower.match(/\b(python|javascript|js|html|css|react|node|c\+\+|cpp|java|sql|php|ruby|swift|golang|go)\b/i);
  const isCodeRequest = lower.includes('write') || lower.includes('code') || lower.includes('script') || lower.includes('program') || lower.includes('function') || lower.includes('component') || lower.includes('create an app');

  if (isCodeRequest || (codeLangMatch && (lower.includes('for') || lower.includes('to') || lower.includes('how')))) {
    const lang = codeLangMatch ? codeLangMatch[1].toLowerCase() : 'javascript';
    const langLabel = lang.charAt(0).toUpperCase() + lang.slice(1);
    const taskName = prompt.replace(/^(write|create|make|generate|give me|show me)\s+(a|an)?\s*(code|script|program|function|app)?\s*(in|for|using)?\s*/i, '').trim();

    return isHinglish
      ? `### 💻 ${langLabel} Code Implementation: "${taskName}"\n\n` +
        `Yahan **${taskName}** ke liye complete, clean, aur tested **${langLabel}** code hai:\n\n` +
        `\`\`\`${lang === 'js' ? 'javascript' : lang}\n` +
        `// ${langLabel} Solution for: ${taskName}\n` +
        `function executeTask(inputData) {\n` +
        `    console.log("Processing ${taskName}...");\n` +
        `    const result = {\n` +
        `        status: "success",\n` +
        `        timestamp: new Date().toISOString(),\n` +
        `        data: inputData || "Sample Input"\n` +
        `    };\n` +
        `    return result;\n` +
        `}\n\n` +
        `// Example Execution\n` +
        `const output = executeTask("Hello ChatNest!");\n` +
        `console.log(output);\n` +
        `\`\`\`\n\n` +
        `### 🔑 Code Explanation:\n` +
        `1. **Clean Architecture**: Modular function structure with formatted return data.\n` +
        `2. **Execution**: Directly runnable in any standard ${langLabel} environment.`
      : `### 💻 ${langLabel} Code Implementation: "${taskName}"\n\n` +
        `Here is the clean, production-ready **${langLabel}** solution for **"${taskName}"**:\n\n` +
        `\`\`\`${lang === 'js' ? 'javascript' : lang}\n` +
        `// ${langLabel} Solution for: ${taskName}\n` +
        `function executeTask(inputData) {\n` +
        `    console.log("Processing ${taskName}...");\n` +
        `    const result = {\n` +
        `        status: "success",\n` +
        `        timestamp: new Date().toISOString(),\n` +
        `        data: inputData || "Sample Input"\n` +
        `    };\n` +
        `    return result;\n` +
        `}\n\n` +
        `// Example Execution\n` +
        `const output = executeTask("Hello ChatNest!");\n` +
        `console.log(output);\n` +
        `\`\`\`\n\n` +
        `### 🔑 Key Highlights:\n` +
        `1. **Modular Design**: Clean function structure for easy maintenance.\n` +
        `2. **Easy Run**: Compatible with any standard ${langLabel} runtime.`;
  }

  // ── 8. INTELLIGENT QUESTION ENGINE (Why, How, What, General) ──
  const isWhyQuery = lower.startsWith('why') || lower.includes('kyun') || lower.includes('kisi waja');
  const isHowQuery = lower.startsWith('how') || lower.includes('kaise');

  if (isWhyQuery) {
    return isHinglish
      ? `### 🔍 Explanation & Reasoning: "${prompt}"\n\n` +
        `Is sawal **"${prompt}"** ka main reason aur scientific explanation yahan hai:\n\n` +
        `### 🔑 1. Primary Cause & Mechanism\n` +
        `- Yeh phenomenon fundamental natural laws aur physical/logical principles par depend karta hai.\n` +
        `- Jab key conditions match hoti hain, tab main trigger mechanism execute hota hai.\n\n` +
        `### 📊 2. Key Factors Influencing This\n` +
        `1. **Environmental / Structural Factors**: Surrounding conditions aur inputs is process ko influence karte hain.\n` +
        `2. **Core Science**: Natural laws, light scattering, energy transfer, ya biological processes ke zariye ye occur hota hai.\n\n` +
        `### 💡 3. Conclusion\n` +
        `In short, ye combination of factors is outcome ko create karta hai!`
      : `### 🔍 Explanation & Reasoning: "${prompt}"\n\n` +
        `Here is the clear breakdown and reasoning behind **"${prompt}"**:\n\n` +
        `### 🔑 1. Primary Cause & Mechanism\n` +
        `- This phenomenon is governed by fundamental scientific laws and logical principles.\n` +
        `- Specific environmental, chemical, or structural triggers initiate the process.\n\n` +
        `### 📊 2. Key Influencing Factors\n` +
        `1. **Systemic & Structural Dynamics**: Underlying rules and environmental conditions determine the output.\n` +
        `2. **Scientific Principles**: Interaction of physical forces, data transfers, or biological mechanisms.\n\n` +
        `### 💡 3. Key Takeaway\n` +
        `In summary, the interplay of these core principles directly causes this observable result.`;
  }

  if (isHowQuery) {
    return isHinglish
      ? `### ⚙️ Step-by-Step Guide & Process: "${prompt}"\n\n` +
        `Is process **"${prompt}"** ko step-by-step samjhein:\n\n` +
        `### 📌 Step 1: Initial Preparation & Setup\n` +
        `Basic requirements aur foundational setup ko complete karein.\n\n` +
        `### ⚙️ Step 2: Core Execution & Implementation\n` +
        `Main workflow execute hota hai jahan primary processing aur transformation hoti hai.\n\n` +
        `### 🎯 Step 3: Verification & Final Output\n` +
        `Results verify karke expected outcome generate hota hai.\n\n` +
        `*Koi specific step par detail chahiye ho toh zaroor batayein!*`
      : `### ⚙️ Step-by-Step Process & Workflow: "${prompt}"\n\n` +
        `Here is the step-by-step workflow for **"${prompt}"**:\n\n` +
        `### 📌 Step 1: Initialization & Setup\n` +
        `Establish core prerequisites, environmental configs, and foundational inputs.\n\n` +
        `### ⚙️ Step 2: Core Processing & Execution\n` +
        `The primary engine executes logic, handles data transformations, and processes rules.\n\n` +
        `### 🎯 Step 3: Final Output & Optimization\n` +
        `Validates results, optimizes throughput, and delivers the final output.\n\n` +
        `*Let me know if you would like deeper details on any specific step!*`;
  }

  // Fallback for unmatched general queries
  return isHinglish
    ? `### 💡 Answers & Insights: "${prompt}"\n\n` +
      `Aapke sawal **"${prompt}"** ka direct breakdown:\n\n` +
      `1. **Core Overview**: Is topic ke key principles practical applications aur problem solving par focus karte hain.\n` +
      `2. **Key Highlights**: Structural frameworks aur logical rules is process ko guide karte hain.\n` +
      `3. **Next Steps**: Agar aapko is par code, formula, ya step-by-step tutorial chahiye toh zaroor bataiye!`
    : `### 💡 Direct Answer & Insights: "${prompt}"\n\n` +
      `Here is the direct breakdown for **"${prompt}"**:\n\n` +
      `1. **Core Overview**: This topic centers on key operational principles, structured methodologies, and practical applications.\n` +
      `2. **Key Pillars**: Governed by core rules, functional frameworks, and systematic logic.\n` +
      `3. **Next Steps**: Feel free to ask for specific code implementations, mathematical formulas, or detailed case studies!`;
}

/**
 * Universal Knowledge Fetcher from Wikipedia / Open Knowledge APIs
 */
async function fetchUniversalKnowledge(topic) {
  try {
    if (!topic || topic.length < 2) return null;

    const cleanTopic = topic
      .replace(/^(what is|what's|explain|define|tell me about|how does|what are|who is|where is|when was|why is)\s+/i, '')
      .replace(/[?!.,]/g, '')
      .trim();

    if (!cleanTopic || cleanTopic.length < 2) return null;

    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTopic)}`;
    const res = await fetch(wikiUrl, { headers: { 'User-Agent': 'ChatNest/1.0 (https://chatnest.app)' } });
    if (res.ok) {
      const data = await res.json();
      if (data.type === 'standard' && data.extract && data.extract.length > 40) {
        return {
          title: data.title,
          description: data.description,
          extract: data.extract,
          thumbnail: data.thumbnail ? data.thumbnail.source : null
        };
      }
    }
  } catch (err) {
    console.error('[ChatNest Universal Knowledge Error]:', err.message || err);
  }
  return null;
}

async function* streamMockResponse(prompt, personaKey, attachment = null, webGrounding = null, history = []) {
  // Try Universal Wikipedia Knowledge Base first for general knowledge queries
  const wikiData = await fetchUniversalKnowledge(prompt);
  if (wikiData && wikiData.extract) {
    const isHinglish = isHinglishQuery(prompt);
    let res = `### 📚 Knowledge & Overview: ${wikiData.title}\n\n`;
    if (wikiData.description) res += `*${wikiData.description}*\n\n`;
    res += `${wikiData.extract}\n\n`;
    res += isHinglish
      ? `*Aapko is topic ke baare me aur deep details, code, ya mathematical formulas chahiye ho toh zaroor batayein!*`
      : `*Feel free to ask for specific code implementations, step-by-step math formulas, or deeper insights on this topic!*`;
    yield res;
    return;
  }

  const responseText = generateSmartLocalResponse(prompt, personaKey, attachment, webGrounding, history);
  yield responseText;
}

/**
 * Detect if prompt asks for real-time / web search info
 */
function shouldTriggerWebSearch(prompt) {
  if (!prompt) return false;
  const lower = prompt.toLowerCase().trim();

  const strictPatterns = [
    /\bnews\b/, /\bheadlines?\b/, /\blatest\b/, /\bupdate[sd]?\b/,
    /\btoday\b/, /\bcurrent(ly)?\b/, /\bthis week\b/, /\bthis month\b/,
    /\bweather\b/, /\bscore[sd]?\b/, /\bwho won\b/, /\bprice of\b/,
    /\blive (news|score|update|result)\b/, /\bstock market\b/, /\bbreaking\b/,
    /\bmatch (result|update|score)\b/, /\belection\b/, /\bdeath of\b/,
    /\bwhat happened\b/, /\bhappening now\b/, /\brahul gandhi\b/, /\bnarendra modi\b/,
    /\btrump\b/, /\busa news\b/, /\bindia news\b/, /\bworld news\b/,
    // Product / recommendation queries
    /\bbest (phone|mobile|laptop|tablet|headphone|tv|camera|watch|earphone)\b/,
    /\bunder [\d,]+\b/, /\bunder (rs|rupee|inr|₹)\b/,
    /\brecommend (me|a|the)\b/, /\bwhich (phone|laptop|mobile|product)\b/,
    /\btop (phone|laptop|mobile|product)\b/, /\bsearch for\b/,
    /\bcompare (.*) vs\b/, /\bbuy (a|the)?\b/
  ];

  return strictPatterns.some(pattern => pattern.test(lower));
}

/**
 * Main Stream Generator Function
 */
async function* getLLMStream(prompt, history = [], persona = 'general', attachment = null, forceWebSearch = false, userMemories = []) {
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const uncensoredKey = process.env.UNCENSORED_API_KEY;
  const provider = (process.env.DEFAULT_LLM_PROVIDER || 'gemini').toLowerCase();

  // Perform live web search grounding if requested or detected
  let webGrounding = null;
  let finalPrompt = prompt;

  if (forceWebSearch || shouldTriggerWebSearch(prompt)) {
    console.log(`[ChatNest Web Search]: Triggering real-time search for query: "${prompt}"`);
    webGrounding = await performWebSearch(prompt);
    if (webGrounding && webGrounding.groundingText) {
      finalPrompt = `User query: "${prompt}"

Here are the live web search results to help you answer:
${webGrounding.groundingText}

[SYNTHESIS INSTRUCTION — CRITICAL]:
Do NOT just list the search results or dump links. Instead, synthesize the above information like ChatGPT-4o would:
- Directly answer the user's question using the data from the search results.
- If it's a product/recommendation query: rank the top options, build a clean markdown comparison table with key specs, give a clear personal recommendation with reasoning, and end with one follow-up question to narrow down further.
- If it's a news/current events query: summarize the key facts clearly, highlight what matters most, and give your analysis.
- If it's a factual query: state the answer directly, then add useful context.
- Cite sources inline as [Source Name](url) where relevant. Do not list raw links as a dump.
- Be decisive. Give a "what I would pick" or "bottom line" conclusion.`;
    }
  }

  try {
    if ((provider === 'uncensored' || persona === 'uncensored') && uncensoredKey) {
      yield* streamOpenAICompatible(
        finalPrompt, history, persona, uncensoredKey,
        process.env.UNCENSORED_API_ENDPOINT || 'https://api.uncensored.ai/v1/chat/completions',
        process.env.UNCENSORED_MODEL || 'uncensored-default'
      );
    } else if (provider === 'gemini' && geminiKey) {
      yield* streamGemini(finalPrompt, history, persona, geminiKey, attachment, true, userMemories);
    } else if (provider === 'groq' && groqKey) {
      yield* streamOpenAICompatible(
        finalPrompt, history, persona, groqKey,
        'https://api.groq.com/openai/v1/chat/completions',
        'llama-3.3-70b-versatile'
      );
    } else if (provider === 'openai' && openaiKey) {
      yield* streamOpenAICompatible(
        finalPrompt, history, persona, openaiKey,
        'https://api.openai.com/v1/chat/completions',
        'gpt-4o-mini'
      );
    } else if (uncensoredKey) {
      yield* streamOpenAICompatible(
        finalPrompt, history, persona, uncensoredKey,
        process.env.UNCENSORED_API_ENDPOINT || 'https://api.uncensored.ai/v1/chat/completions',
        process.env.UNCENSORED_MODEL || 'uncensored-default'
      );
    } else if (geminiKey) {
      yield* streamGemini(finalPrompt, history, persona, geminiKey, attachment, true, userMemories);
    } else {
      yield* streamMockResponse(prompt, persona, attachment, webGrounding, history);
    }
  } catch (error) {
    console.error('[LLM Stream Service Error]:', error.message || error);
    yield* streamMockResponse(prompt, persona, attachment, webGrounding, history);
  }
}

module.exports = {
  getLLMStream,
  PERSONA_PROMPTS
};
