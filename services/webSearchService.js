/**
 * Web Search Service for ChatNest
 * Provides live real-time internet search capability via DuckDuckGo & Wikipedia APIs
 */

const https = require('https');

/**
 * Perform a DuckDuckGo HTML search to extract search result snippets
 */
async function searchDuckDuckGo(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    const results = [];

    if (response.ok) {
      const html = await response.text();
      // Flexible regex extraction for DuckDuckGo HTML results
      const resultRegex = /<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      
      let match;
      let count = 0;
      while ((match = resultRegex.exec(html)) !== null && count < 5) {
        let rawUrl = match[1];
        let title = match[2].replace(/<[^>]+>/g, '').trim();
        let snippet = match[3].replace(/<[^>]+>/g, '').trim();

        if (rawUrl.includes('uddg=')) {
          try {
            const urlParam = new URLSearchParams(rawUrl.split('?')[1] || '').get('uddg');
            if (urlParam) rawUrl = decodeURIComponent(urlParam);
          } catch (e) {}
        }

        if (title && snippet) {
          results.push({ title, snippet, url: rawUrl });
          count++;
        }
      }
    }

    // If HTML scraping yields no results, fallback to DuckDuckGo Instant Answer JSON API
    if (results.length === 0) {
      try {
        const apiController = new AbortController();
        const apiTimeoutId = setTimeout(() => apiController.abort(), 6000);
        let apiResponse;
        try {
          apiResponse = await fetch(`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&no_redirect=1`, { signal: apiController.signal });
        } finally {
          clearTimeout(apiTimeoutId);
        }
        if (apiResponse.ok) {
          const apiData = await apiResponse.json();
          if (apiData.AbstractText) {
            results.push({
              title: apiData.Heading || query,
              snippet: apiData.AbstractText,
              url: apiData.AbstractURL || `https://duckduckgo.com/?q=${encodedQuery}`
            });
          }
          if (Array.isArray(apiData.RelatedTopics)) {
            for (const topic of apiData.RelatedTopics) {
              if (topic.Text && topic.FirstURL && results.length < 5) {
                results.push({
                  title: topic.Text.split(' - ')[0] || query,
                  snippet: topic.Text,
                  url: topic.FirstURL
                });
              }
            }
          }
        }
      } catch (apiErr) {}
    }

    return results;
  } catch (err) {
    console.warn('[Web Search Service Error]:', err.message);
    return [];
  }
}

/**
 * Perform a Wikipedia search to get instant factual knowledge
 */
async function searchWikipedia(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodedQuery}&format=json&utf8=1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) return [];

    const data = await response.json();
    const searchResults = data?.query?.search || [];

    return searchResults.slice(0, 3).map(item => ({
      title: item.title,
      snippet: item.snippet.replace(/<[^>]+>/g, ''),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`
    }));
  } catch (err) {
    return [];
  }
}

// In-Memory Web Search Result Cache (15-Minute TTL)
const searchCache = new Map();
const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;

function getCachedSearchResults(query) {
  const key = query.toLowerCase().trim();
  const cached = searchCache.get(key);
  if (cached && (Date.now() - cached.timestamp < SEARCH_CACHE_TTL_MS)) {
    return cached.data;
  }
  if (cached) searchCache.delete(key); // Evict expired
  return null;
}

function setCachedSearchResults(query, data) {
  const key = query.toLowerCase().trim();
  // Keep cache bounded to 100 entries max to prevent memory growth
  if (searchCache.size > 100) {
    const oldestKey = searchCache.keys().next().value;
    searchCache.delete(oldestKey);
  }
  searchCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Main Search Grounding function: Returns structured web grounding context
 */
async function performWebSearch(query) {
  if (!query || !query.trim()) return null;

  // Check in-memory cache first
  const cached = getCachedSearchResults(query);
  if (cached) {
    console.log(`[Web Search Cache Hit]: "${query}"`);
    return cached;
  }

  try {
    const [ddgResults, wikiResults] = await Promise.all([
      searchDuckDuckGo(query),
      searchWikipedia(query)
    ]);

    const combined = [...ddgResults];
    
    // Append wiki results if not duplicate
    for (const wiki of wikiResults) {
      if (!combined.some(r => r.title.toLowerCase().includes(wiki.title.toLowerCase()))) {
        combined.push(wiki);
      }
    }

    if (combined.length === 0) return null;

    // Build markdown ground context
    let groundingContext = `\n\n[REAL-TIME LIVE WEB SEARCH DATA FOR QUERY: "${query}"]\n`;
    combined.slice(0, 5).forEach((res, idx) => {
      groundingContext += `${idx + 1}. **${res.title}**\n   Snippet: ${res.snippet}\n   Source: ${res.url}\n`;
    });
    groundingContext += `[END OF REAL-TIME WEB SEARCH DATA. Incorporate this live data into your answer seamlessly and cite sources where relevant.]\n\n`;

    const resultObj = {
      results: combined.slice(0, 5),
      groundingText: groundingContext
    };

    setCachedSearchResults(query, resultObj);
    return resultObj;
  } catch (err) {
    console.warn('[Web Search Grounding Warning]:', err.message);
    return null;
  }
}

module.exports = {
  performWebSearch
};
