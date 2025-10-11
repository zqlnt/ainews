/**
 * Cache Warmer - Pre-fetches options data for popular symbols
 * Runs on server startup and periodically in background
 */

import { fetchOptions } from './optionsProvider.js';

// Top symbols to keep warm (most liquid options markets)
const WARM_SYMBOLS = [
  'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 
  'AMZN', 'GOOGL', 'META', 'AMD'
];

const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
let warmingInterval = null;

/**
 * Warm the cache for a single symbol
 * @param {string} symbol - Stock symbol
 * @returns {Promise<boolean>} Success status
 */
async function warmSymbol(symbol) {
  try {
    console.log(`[${new Date().toISOString()}] 🔥 Warming cache for ${symbol}...`);
    const result = await fetchOptions(symbol);
    
    if (result.rows && result.rows.length > 0) {
      console.log(`[${new Date().toISOString()}] ✅ Warmed ${symbol}: ${result.rows.length} rows cached`);
      return true;
    } else {
      console.log(`[${new Date().toISOString()}] ⚠️  ${symbol}: No valid options`);
      return false;
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Failed to warm ${symbol}: ${error.message}`);
    return false;
  }
}

/**
 * Warm cache for all popular symbols
 * @param {boolean} sequential - If true, fetch one at a time (slower but safer)
 * @returns {Promise<{total: number, success: number, failed: number}>}
 */
export async function warmCache(sequential = false) {
  console.log(`[${new Date().toISOString()}] 🔥🔥🔥 Starting cache warm-up for ${WARM_SYMBOLS.length} symbols...`);
  const startTime = Date.now();
  
  let results;
  if (sequential) {
    // Sequential: one at a time (safer, slower)
    results = [];
    for (const symbol of WARM_SYMBOLS) {
      const success = await warmSymbol(symbol);
      results.push(success);
      // Small delay between requests to avoid hammering yfinance
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } else {
    // Parallel: all at once (faster, but may hit rate limits)
    results = await Promise.all(WARM_SYMBOLS.map(warmSymbol));
  }
  
  const success = results.filter(r => r).length;
  const failed = results.length - success;
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`[${new Date().toISOString()}] 🎯 Cache warm-up complete: ${success}/${WARM_SYMBOLS.length} symbols cached in ${duration}s`);
  
  return { total: WARM_SYMBOLS.length, success, failed };
}

/**
 * Start background cache refresh job
 * Runs every REFRESH_INTERVAL_MS to keep cache fresh
 */
export function startBackgroundRefresh() {
  if (warmingInterval) {
    console.log(`[${new Date().toISOString()}] ⚠️  Background refresh already running`);
    return;
  }
  
  console.log(`[${new Date().toISOString()}] 🔄 Starting background cache refresh (every ${REFRESH_INTERVAL_MS / 1000 / 60} min)`);
  
  warmingInterval = setInterval(async () => {
    console.log(`[${new Date().toISOString()}] 🔄 Running scheduled cache refresh...`);
    await warmCache(true); // Sequential to avoid rate limits
  }, REFRESH_INTERVAL_MS);
}

/**
 * Stop background cache refresh job
 */
export function stopBackgroundRefresh() {
  if (warmingInterval) {
    clearInterval(warmingInterval);
    warmingInterval = null;
    console.log(`[${new Date().toISOString()}] ⏹️  Background refresh stopped`);
  }
}

/**
 * Initialize cache warmer on startup
 * @param {Object} options - Configuration options
 * @param {boolean} options.immediate - Warm cache immediately on startup
 * @param {boolean} options.background - Start background refresh job
 * @param {boolean} options.sequential - Use sequential fetching (safer for startup)
 */
export async function initCacheWarmer({ immediate = true, background = true, sequential = true } = {}) {
  if (immediate) {
    // Don't await - let it run in background so server starts faster
    warmCache(sequential).catch(err => {
      console.error(`[${new Date().toISOString()}] ❌ Cache warm-up failed:`, err);
    });
  }
  
  if (background) {
    startBackgroundRefresh();
  }
}

