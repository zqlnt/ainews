/**
 * News types for /newsfeed/blocks endpoint
 */

/**
 * @typedef {'ok' | 'degraded' | 'fallback'} BlockStatus
 */

/**
 * @typedef {'bullish' | 'neutral' | 'bearish'} Sentiment
 */

/**
 * @typedef {Object} NewsItem
 * @property {string} title
 * @property {string} source
 * @property {string} url
 * @property {string} [image]
 * @property {string[]} [tickers]
 * @property {string} published_at - ISO 8601
 * @property {string} age - e.g., "5m", "2h", "3d"
 * @property {Sentiment} [sentiment] - Sentiment classification
 * @property {string} [sentiment_source] - 'heuristic' or 'ai'
 * @property {string} [sentiment_version] - e.g., 'news-v1'
 */

/**
 * @typedef {Object} NewsBlocks
 * @property {string} generated_at - ISO 8601
 * @property {BlockStatus} status
 * @property {number} freshness_seconds
 * @property {NewsItem} [hero]
 * @property {NewsItem[]} tiles - max 2
 * @property {NewsItem[]} latest
 * @property {string} [note] - Additional status information
 */

// Export empty object to make this a module
export {};
