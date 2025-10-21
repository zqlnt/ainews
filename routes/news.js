/**
 * News routes - /news/blocks endpoint
 */

import express from 'express';
import crypto from 'crypto';
import { fetchJSON } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import { getCurrentTimeISO, getAgeString } from '../lib/time.js';
import { canonicalizeUrl, createDedupeKey } from '../lib/url.js';
import { enrichWithSentiment } from '../lib/sentiment.js';

/**
 * @typedef {import('../types/news.js').NewsItem} NewsItem
 * @typedef {import('../types/news.js').NewsBlocks} NewsBlocks
 * @typedef {import('../types/news.js').BlockStatus} BlockStatus
 */

const router = express.Router();

// Finnhub API key from environment
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

// Cache TTLs
const FRESH_TTL_SEC = 60; // 1 minute fresh
const STALE_TTL_SEC = 3600; // 1 hour stale

// Topic to Finnhub category mapping
const TOPIC_CATEGORIES = {
  market: 'general',
  crypto: 'crypto',
  equities: 'general',
  macro: 'forex'
};

/**
 * @typedef {Object} FinnhubNewsItem
 * @property {string} category
 * @property {number} datetime
 * @property {string} headline
 * @property {number} id
 * @property {string} image
 * @property {string} related
 * @property {string} source
 * @property {string} summary
 * @property {string} url
 */

/**
 * Fetch news from Finnhub
 * @param {string} category
 * @returns {Promise<FinnhubNewsItem[]>}
 */
async function fetchFinnhubNews(category) {
  const url = `https://finnhub.io/api/v1/news?category=${category}&token=${FINNHUB_API_KEY}`;
  return fetchJSON(url, { timeout: 4000 });
}

/**
 * Normalize Finnhub item to NewsItem
 * @param {FinnhubNewsItem} item
 * @param {string} baseUrl
 * @returns {NewsItem}
 */
function normalizeNewsItem(item, baseUrl) {
  const publishedAt = new Date(item.datetime * 1000).toISOString();
  const canonicalUrl = canonicalizeUrl(item.url);
  
  const newsItem = {
    title: item.headline.trim(),
    source: item.source,
    url: canonicalUrl,
    published_at: publishedAt,
    age: getAgeString(publishedAt)
  };
  
  // Add image if present (proxy through /img)
  if (item.image) {
    newsItem.image = `${baseUrl}/img?src=${encodeURIComponent(item.image)}`;
  }
  
  // Parse tickers from related field (comma-separated)
  if (item.related && item.related.trim()) {
    const tickers = item.related.split(',')
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0);
    
    if (tickers.length > 0) {
      newsItem.tickers = tickers;
    }
  }
  
  // Add sentiment classification
  return enrichWithSentiment({
    ...newsItem,
    summary: item.summary || ''
  });
}

/**
 * Deduplicate news items
 * @param {NewsItem[]} items
 * @returns {NewsItem[]}
 */
function deduplicateNews(items) {
  const seen = new Set();
  const deduplicated = [];
  
  for (const item of items) {
    const key = createDedupeKey(item.title, item.url);
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(item);
    }
  }
  
  return deduplicated;
}

/**
 * Select hero, tiles, and latest from news items
 * @param {NewsItem[]} items
 * @param {number} limit
 * @returns {Pick<NewsBlocks, 'hero' | 'tiles' | 'latest'>}
 */
function selectNewsBlocks(items, limit) {
  const result = {
    tiles: [],
    latest: []
  };
  
  if (items.length === 0) {
    return result;
  }
  
  // Sort by published_at descending (newest first)
  const sorted = [...items].sort((a, b) => 
    new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );
  
  let remaining = [...sorted];
  
  // 1. Pick hero: newest item with image, or just newest
  const heroWithImage = remaining.find(item => item.image);
  if (heroWithImage) {
    result.hero = heroWithImage;
    remaining = remaining.filter(item => item !== heroWithImage);
  } else if (remaining.length > 0) {
    result.hero = remaining[0];
    remaining = remaining.slice(1);
  }
  
  // 2. Pick up to 2 tiles: prefer items with images
  const tilesWithImages = remaining.filter(item => item.image).slice(0, 2);
  result.tiles = tilesWithImages;
  remaining = remaining.filter(item => !tilesWithImages.includes(item));
  
  // If we don't have 2 tiles yet, fill from remaining
  if (result.tiles.length < 2 && remaining.length > 0) {
    const needed = 2 - result.tiles.length;
    result.tiles.push(...remaining.slice(0, needed));
    remaining = remaining.slice(needed);
  }
  
  // 3. Put rest into latest until we reach limit
  const heroCount = result.hero ? 1 : 0;
  const tilesCount = result.tiles.length;
  const latestCount = limit - heroCount - tilesCount;
  
  result.latest = remaining.slice(0, Math.max(0, latestCount));
  
  return result;
}

/**
 * Filter items by sentiment
 * @param {NewsItem[]} items
 * @param {string} sentiment - 'all', 'bullish', 'neutral', 'bearish'
 * @returns {NewsItem[]}
 */
function filterBySentiment(items, sentiment) {
  if (sentiment === 'all') return items;
  return items.filter(item => item.sentiment === sentiment);
}

/**
 * Shuffle array with a seeded PRNG for stable ordering within a time bucket
 * @param {Array} array
 * @param {number} seed
 * @returns {Array}
 */
function shuffleWithSeed(array, seed) {
  const shuffled = [...array];
  let currentIndex = shuffled.length;
  
  // Simple seeded random using linear congruential generator
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  
  while (currentIndex !== 0) {
    const randomIndex = Math.floor(random() * currentIndex);
    currentIndex--;
    [shuffled[currentIndex], shuffled[randomIndex]] = 
      [shuffled[randomIndex], shuffled[currentIndex]];
  }
  
  return shuffled;
}

/**
 * Generate ETag from content
 * @param {string} content
 * @returns {string}
 */
function generateETag(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * GET /news/blocks?topic=market&limit=12
 * IMPORTANT: This must come BEFORE /:symbol to avoid /blocks being treated as a symbol
 */
router.get('/blocks', async (req, res) => {
  try {
    const topic = req.query.topic || 'market';
    const limit = Math.max(6, Math.min(30, parseInt(req.query.limit) || 12));
    const sentiment = req.query.sentiment || 'all';
    const strict = req.query.strict === '1';
    
    // Validate topic and sentiment
    const category = TOPIC_CATEGORIES[topic] || TOPIC_CATEGORIES.market;
    const validSentiments = ['all', 'bullish', 'neutral', 'bearish'];
    const sentimentFilter = validSentiments.includes(sentiment) ? sentiment : 'all';
    
    // Include sentiment and minute bucket in cache key for 'all' (stable shuffle)
    const minuteBucket = sentimentFilter === 'all' ? Math.floor(Date.now() / 60000) : 0;
    const cacheKey = `news:blocks:${topic}:${limit}:${sentimentFilter}:${minuteBucket}`;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    let blocks = null;
    let status = 'ok';
    let freshnessSeconds = 0;
    let note = undefined;
    
    // Try fresh cache
    const freshBlocks = cache.getFresh(cacheKey);
    if (freshBlocks) {
      freshnessSeconds = cache.ageSeconds(cacheKey) || 0;
      blocks = { ...freshBlocks, freshness_seconds: freshnessSeconds };
      
      console.log(`[${getCurrentTimeISO()}] 📰 Fresh cached news blocks for ${topic}`);
    } else {
      // Try fetching fresh data
      try {
        console.log(`[${getCurrentTimeISO()}] 📰 Fetching fresh news for ${topic}`);
        
        const rawItems = await fetchFinnhubNews(category);
        
        // Normalize and deduplicate
        const normalized = rawItems.map(item => normalizeNewsItem(item, baseUrl));
        let deduplicated = deduplicateNews(normalized);
        
        // Apply sentiment filter
        let filtered = filterBySentiment(deduplicated, sentimentFilter);
        
        // Apply shuffle for 'all' to ensure balanced view
        if (sentimentFilter === 'all' && filtered.length > 0) {
          filtered = shuffleWithSeed(filtered, minuteBucket);
        }
        
        // Handle empty results
        if (filtered.length === 0 && sentimentFilter !== 'all' && !strict) {
          // Fallback to all items
          filtered = sentimentFilter === 'all' ? deduplicated : shuffleWithSeed(deduplicated, minuteBucket);
          status = 'degraded';
          note = `no matches for sentiment: ${sentimentFilter}; returned mixed feed`;
          console.log(`[${getCurrentTimeISO()}] ⚠️  No ${sentimentFilter} items, falling back to mixed feed`);
        }
        
        // Log sentiment distribution
        console.log(`[${getCurrentTimeISO()}] 📊 news_sentiment_blocks_${sentimentFilter} (${filtered.length} items)`);
        
        // Select hero, tiles, latest
        const selected = selectNewsBlocks(filtered, limit);
        
        blocks = {
          generated_at: getCurrentTimeISO(),
          status,
          freshness_seconds: 0,
          ...selected
        };
        
        if (note) {
          blocks.note = note;
        }
        
        // Cache it
        cache.put(cacheKey, blocks, FRESH_TTL_SEC, STALE_TTL_SEC);
        
        console.log(`[${getCurrentTimeISO()}] ✅ Fetched ${rawItems.length} news items, selected ${(selected.hero ? 1 : 0) + selected.tiles.length + selected.latest.length} for blocks`);
        
      } catch (error) {
        // Fetch failed, try stale cache
        const staleBlocks = cache.getStale(cacheKey);
        
        if (staleBlocks) {
          freshnessSeconds = cache.ageSeconds(cacheKey) || 0;
          blocks = { 
            ...staleBlocks, 
            status: 'fallback',
            freshness_seconds: freshnessSeconds 
          };
          status = 'fallback';
          
          console.log(`[${getCurrentTimeISO()}] ⚠️  Using stale news cache for ${topic} (age: ${Math.floor(freshnessSeconds / 60)}m)`);
        } else {
          // No cache at all, return degraded response with empty data
          console.error(`[${getCurrentTimeISO()}] ❌ No news data available for ${topic}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          
          blocks = {
            generated_at: getCurrentTimeISO(),
            status: 'degraded',
            freshness_seconds: 0,
            tiles: [],
            latest: []
          };
          status = 'degraded';
        }
      }
    }
    
    if (!blocks) {
      // Should never happen, but safety fallback
      blocks = {
        generated_at: getCurrentTimeISO(),
        status: 'degraded',
        freshness_seconds: 0,
        tiles: [],
        latest: []
      };
    }
    
    // Generate ETag
    const content = JSON.stringify(blocks);
    const etag = generateETag(content);
    
    // Check If-None-Match
    const ifNoneMatch = req.get('If-None-Match');
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }
    
    // Set headers
    res.set({
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=3600',
      'ETag': etag,
      'Content-Type': 'application/json'
    });
    
    res.json(blocks);
    
  } catch (error) {
    console.error(`[${getCurrentTimeISO()}] ❌ /news/blocks error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    // Never return 500, always return degraded response
    res.json({
      generated_at: getCurrentTimeISO(),
      status: 'degraded',
      freshness_seconds: 0,
      tiles: [],
      latest: []
    });
  }
});

/**
 * Fetch symbol-specific news from Finnhub
 * @param {string} symbol
 * @returns {Promise<FinnhubNewsItem[]>}
 */
async function fetchSymbolNews(symbol) {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  const formatDate = (date) => date.toISOString().split('T')[0];
  const from = formatDate(weekAgo);
  const to = formatDate(today);
  
  const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol.toUpperCase()}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
  return fetchJSON(url, { timeout: 4000 });
}

/**
 * GET /news/:symbol?limit=12
 */
router.get('/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const limit = Math.max(1, Math.min(30, parseInt(req.query.limit) || 12));
    const sentiment = req.query.sentiment || 'all';
    const strict = req.query.strict === '1';
    
    // Validate sentiment
    const validSentiments = ['all', 'bullish', 'neutral', 'bearish'];
    const sentimentFilter = validSentiments.includes(sentiment) ? sentiment : 'all';
    
    const cacheKey = `news:symbol:${symbol}:${limit}:${sentimentFilter}`;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    let items = [];
    let status = 'ok';
    let freshnessSeconds = 0;
    let note = undefined;
    
    // Try fresh cache
    const cached = cache.getFresh(cacheKey);
    if (cached) {
      items = cached;
      freshnessSeconds = cache.ageSeconds(cacheKey) || 0;
      console.log(`[${getCurrentTimeISO()}] 📰 Fresh cached symbol news for ${symbol}`);
    } else {
      // Try fetching fresh data
      try {
        console.log(`[${getCurrentTimeISO()}] 📰 Fetching fresh news for symbol ${symbol}`);
        
        const rawItems = await fetchSymbolNews(symbol);
        
        // Normalize and deduplicate
        const normalized = rawItems.map(item => normalizeNewsItem(item, baseUrl));
        const deduplicated = deduplicateNews(normalized);
        
        // Apply sentiment filter
        let filtered = filterBySentiment(deduplicated, sentimentFilter);
        
        // Handle empty results
        if (filtered.length === 0 && sentimentFilter !== 'all' && !strict) {
          // Fallback to all items
          filtered = deduplicated;
          status = 'degraded';
          note = `no matches for sentiment: ${sentimentFilter}; returned mixed feed`;
          console.log(`[${getCurrentTimeISO()}] ⚠️  No ${sentimentFilter} items for ${symbol}, falling back to mixed feed`);
        }
        
        // Log sentiment distribution
        console.log(`[${getCurrentTimeISO()}] 📊 news_sentiment_symbol_${sentimentFilter} (${symbol}: ${filtered.length} items)`);
        
        // Sort by published_at descending and limit
        items = filtered
          .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
          .slice(0, limit);
        
        // Cache it
        cache.put(cacheKey, items, FRESH_TTL_SEC, STALE_TTL_SEC);
        
        console.log(`[${getCurrentTimeISO()}] ✅ Fetched ${rawItems.length} news items for ${symbol}, returned ${items.length}`);
        
      } catch (error) {
        // Fetch failed, try stale cache
        const staleItems = cache.getStale(cacheKey);
        
        if (staleItems) {
          items = staleItems;
          freshnessSeconds = cache.ageSeconds(cacheKey) || 0;
          status = 'fallback';
          
          console.log(`[${getCurrentTimeISO()}] ⚠️  Using stale symbol news cache for ${symbol} (age: ${Math.floor(freshnessSeconds / 60)}m)`);
        } else {
          // No cache at all, return empty with degraded status
          console.error(`[${getCurrentTimeISO()}] ❌ No symbol news available for ${symbol}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          status = 'degraded';
          items = [];
        }
      }
    }
    
    const response = {
      symbol,
      status,
      freshness_seconds: freshnessSeconds,
      count: items.length,
      articles: items
    };
    
    if (note) {
      response.note = note;
    }
    
    // Generate ETag
    const content = JSON.stringify(response);
    const etag = generateETag(content);
    
    // Check If-None-Match
    const ifNoneMatch = req.get('If-None-Match');
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }
    
    // Set headers
    res.set({
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=3600',
      'ETag': etag,
      'Content-Type': 'application/json'
    });
    
    res.json(response);
    
  } catch (error) {
    console.error(`[${getCurrentTimeISO()}] ❌ /news/:symbol error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    // Never return 500, always return degraded response
    res.json({
      symbol: req.params.symbol.toUpperCase(),
      status: 'degraded',
      freshness_seconds: 0,
      count: 0,
      articles: []
    });
  }
});

export default router;

