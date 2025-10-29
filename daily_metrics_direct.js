/**
 * Direct Daily Metrics Logger (Bypasses Render API)
 * 
 * Fetches options data from Polygon.io and writes directly to Supabase
 * More efficient than going through the API
 * 
 * Usage:
 *   node daily_metrics_direct.js
 *   node daily_metrics_direct.js --tickers AAPL,TSLA
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// Top tickers to log daily
const DEFAULT_TICKERS = [
  'SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 
  'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD'
];

/**
 * Fetch options data and spot price from Polygon.io
 */
async function fetchPolygonData(ticker) {
  try {
    // Get options snapshot
    const url = `https://api.polygon.io/v3/snapshot/options/${ticker}?limit=250&apiKey=${POLYGON_API_KEY}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Polygon API error: ${response.status}`);
    }
    
    const data = await response.json();
    const contracts = data.results || [];
    
    // Get spot price from underlying ticker snapshot
    const spotUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${POLYGON_API_KEY}`;
    const spotResponse = await fetch(spotUrl);
    
    let spotPrice = null;
    if (spotResponse.ok) {
      const spotData = await spotResponse.json();
      spotPrice = spotData.ticker?.day?.c || spotData.ticker?.prevDay?.c || null;
    }
    
    return { contracts, spotPrice };
  } catch (error) {
    console.error(`❌ ${ticker}: Failed to fetch Polygon data - ${error.message}`);
    return null;
  }
}

/**
 * Calculate basic metrics from options data
 */
function calculateMetrics(ticker, contracts, spotPrice) {
  if (!contracts || contracts.length === 0) {
    return null;
  }
  
  // Simple calculation - just store raw data
  // Full metrics calculation would replicate lib/polygonProvider.js
  
  // For now, store basic info
  const calls = contracts.filter(c => c.details?.contract_type === 'call');
  const puts = contracts.filter(c => c.details?.contract_type === 'put');
  
  const putCallRatio = puts.length / (calls.length || 1);
  
  // Get ATM strike (closest to spot)
  const atmContract = contracts.reduce((closest, c) => {
    const strike = c.details?.strike_price;
    if (!strike) return closest;
    const diff = Math.abs(strike - spotPrice);
    const closestDiff = Math.abs(closest.details?.strike_price - spotPrice);
    return diff < closestDiff ? c : closest;
  }, contracts[0]);
  
  const atmIV = atmContract?.implied_volatility || null;
  const atmStrike = atmContract?.details?.strike_price || null;
  
  return {
    spot_price: spotPrice,
    atm_iv_value: atmIV,
    atm_iv_strike: atmStrike,
    put_call_oi_ratio: putCallRatio,
    // For full metrics, would need to replicate calculation logic
    // For now, this is a simplified version
  };
}

/**
 * Write metrics directly to Supabase
 */
async function writeToSupabase(ticker, metrics) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  
  const snapshot = {
    ticker: ticker.toUpperCase(),
    spot_price: metrics.spot_price,
    
    // Basic metrics (would need full calculation for all 14)
    atm_iv_value: metrics.atm_iv_value,
    atm_iv_strike: metrics.atm_iv_strike,
    put_call_oi_ratio: metrics.put_call_oi_ratio,
    
    // Metadata
    data_freshness: 'fresh',
    cached_minutes_ago: 0,
    recorded_at: new Date().toISOString(),
    date: new Date().toISOString().split('T')[0]
  };
  
  const { error } = await supabase
    .from('metrics_history')
    .upsert(snapshot, {
      onConflict: 'ticker,date',
      ignoreDuplicates: false
    });
  
  if (error) {
    throw new Error(error.message);
  }
  
  return true;
}

/**
 * Log metrics for a single ticker
 */
async function logTicker(ticker) {
  try {
    console.log(`📊 Logging ${ticker}...`);
    
    // Fetch options data and spot price
    const data = await fetchPolygonData(ticker);
    if (!data) {
      console.log(`⚠️  ${ticker}: No data available`);
      return false;
    }
    
    const { contracts, spotPrice } = data;
    
    if (!spotPrice) {
      console.log(`⚠️  ${ticker}: No spot price available`);
      return false;
    }
    
    if (!contracts || contracts.length === 0) {
      console.log(`⚠️  ${ticker}: No options contracts available`);
      return false;
    }
    
    // Calculate metrics
    const metrics = calculateMetrics(ticker, contracts, spotPrice);
    if (!metrics) {
      console.log(`⚠️  ${ticker}: Failed to calculate metrics`);
      return false;
    }
    
    // Write to Supabase
    await writeToSupabase(ticker, metrics);
    
    console.log(`✅ ${ticker}: Logged (spot: $${spotPrice.toFixed(2)}, ${contracts.length} contracts)`);
    return true;
  } catch (error) {
    console.error(`❌ ${ticker}: ${error.message}`);
    return false;
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log('========================================');
  console.log('📈 DIRECT METRICS LOGGER');
  console.log('========================================');
  
  // Validate environment variables
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
  }
  
  if (!POLYGON_API_KEY) {
    console.error('❌ Missing POLYGON_API_KEY');
    process.exit(1);
  }
  
  const args = process.argv.slice(2);
  let tickers = DEFAULT_TICKERS;
  
  if (args.includes('--tickers')) {
    const tickersArg = args[args.indexOf('--tickers') + 1];
    if (tickersArg) {
      tickers = tickersArg.split(',').map(t => t.trim().toUpperCase());
    }
  }
  
  console.log(`Tickers: ${tickers.join(', ')}`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('========================================');
  console.log('');
  
  const results = { total: tickers.length, success: 0, failed: 0 };
  
  for (const ticker of tickers) {
    const success = await logTicker(ticker);
    if (success) {
      results.success++;
    } else {
      results.failed++;
    }
    
    // Wait 2 seconds between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('');
  console.log('========================================');
  console.log('📊 SUMMARY');
  console.log('========================================');
  console.log(`Total: ${results.total}`);
  console.log(`✅ Success: ${results.success}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Completed: ${new Date().toISOString()}`);
  console.log('========================================');
  
  process.exit(results.success > 0 ? 0 : 1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

