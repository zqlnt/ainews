/**
 * Daily Metrics Logger
 * 
 * Ensures popular tickers are logged daily to metrics_history table
 * Run this as a cron job: 0 10 * * 1-5 (10 AM ET, weekdays only)
 * 
 * Usage:
 *   node daily_metrics_logger.js
 *   node daily_metrics_logger.js --tickers AAPL,TSLA,NVDA
 */

import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'https://ainews-ybbv.onrender.com';

// Top tickers to log daily
const DEFAULT_TICKERS = [
  'SPY',   // S&P 500 ETF
  'QQQ',   // Nasdaq ETF
  'AAPL',  // Apple
  'NVDA',  // NVIDIA
  'TSLA',  // Tesla
  'MSFT',  // Microsoft
  'AMZN',  // Amazon
  'GOOGL', // Google
  'META',  // Meta
  'AMD'    // AMD
];

/**
 * Log metrics for a single ticker
 */
async function logTicker(ticker) {
  try {
    console.log(`📊 Logging ${ticker}...`);
    
    const response = await fetch(`${API_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ticker,
        news: ''
      })
    });
    
    if (!response.ok) {
      console.error(`❌ ${ticker}: HTTP ${response.status}`);
      return false;
    }
    
    const data = await response.json();
    
    // Check if analysis contains quant metrics
    const hasQuant = data.analysis && data.analysis.includes('Quant Metrics:');
    
    if (hasQuant) {
      console.log(`✅ ${ticker}: Logged with quant metrics`);
      return true;
    } else {
      console.log(`⚠️  ${ticker}: Logged but no quant metrics (may be after hours)`);
      return false;
    }
  } catch (error) {
    console.error(`❌ ${ticker}: ${error.message}`);
    return false;
  }
}

/**
 * Log metrics for all tickers
 */
async function logAllTickers(tickers) {
  console.log('========================================');
  console.log('📈 DAILY METRICS LOGGER');
  console.log('========================================');
  console.log(`API: ${API_URL}`);
  console.log(`Tickers: ${tickers.join(', ')}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('========================================');
  console.log('');
  
  const results = {
    total: tickers.length,
    success: 0,
    failed: 0,
    noMetrics: 0
  };
  
  // Process sequentially to avoid rate limits
  for (const ticker of tickers) {
    const success = await logTicker(ticker);
    
    if (success) {
      results.success++;
    } else {
      results.noMetrics++;
    }
    
    // Wait 2 seconds between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('');
  console.log('========================================');
  console.log('📊 SUMMARY');
  console.log('========================================');
  console.log(`Total tickers: ${results.total}`);
  console.log(`✅ Success: ${results.success}`);
  console.log(`⚠️  No metrics: ${results.noMetrics}`);
  console.log(`Completed: ${new Date().toISOString()}`);
  console.log('========================================');
  
  // Exit with error code if all failed
  if (results.success === 0) {
    console.error('❌ No metrics logged - check if markets are open');
    process.exit(1);
  }
  
  process.exit(0);
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Check for custom tickers
  let tickers = DEFAULT_TICKERS;
  if (args.includes('--tickers')) {
    const tickersArg = args[args.indexOf('--tickers') + 1];
    if (tickersArg) {
      tickers = tickersArg.split(',').map(t => t.trim().toUpperCase());
    }
  }
  
  await logAllTickers(tickers);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { logAllTickers, logTicker };

