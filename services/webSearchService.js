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

    const response = await fetch(url, { headers });
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
        const apiResponse = await fetch(`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&no_redirect=1`);
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

    const response = await fetch(url);
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

/**
 * Main Search Grounding function: Returns structured web grounding context
 */
async function performWebSearch(query) {
  if (!query || !query.trim()) return null;

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

    return {
      results: combined.slice(0, 5),
      groundingText: groundingContext
    };
  } catch (err) {
    console.warn('[Web Search Grounding Warning]:', err.message);
    return null;
  }
}

module.exports = {
  performWebSearch
};
