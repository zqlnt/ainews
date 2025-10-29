/**
 * Historical Metrics Logger
 * 
 * Logs daily snapshots of all 14 quant metrics to Supabase
 * - One snapshot per ticker per day
 * - Stores complete metric state for historical analysis
 * - Enables time-series charting and trend analysis
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

let supabase = null;

/**
 * Initialize Supabase client
 */
function getSupabaseClient() {
  if (!supabase && SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabase;
}

/**
 * Check if metrics logging is enabled
 */
export function isMetricsLoggingEnabled() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Log metrics snapshot to Supabase
 * 
 * @param {Object} params - Analysis parameters
 * @param {string} params.ticker - Stock ticker symbol
 * @param {Object} params.priceData - Price data from Alpaca
 * @param {Object} params.optionsData - Options data from Polygon
 * @param {Object} params.gamma - Dealer gamma metrics
 * @param {Object} params.skew - Skew metrics
 * @param {Object} params.atmIV - ATM IV metrics
 * @param {Object} params.putCallVolRatio - Put/Call volume ratio
 * @param {Object} params.impliedMove - Implied move metrics
 * @param {Object} params.maxPain - Max pain metrics
 * @param {Object} params.putCallOIRatio - Put/Call OI ratio
 * @param {Object} params.totalDelta - Total delta metrics
 * @param {Object} params.gammaWalls - Gamma walls
 * @param {Object} params.ivTerm - IV term structure
 * @param {Object} params.zeroGammaLevel - Zero gamma level
 * @param {Object} params.multipleExpectedMoves - Multiple expected moves
 * @param {Object} params.totalVega - Total vega
 * @param {Object} params.vanna - Vanna
 * @returns {Promise<boolean>} Success status
 */
export async function logMetricsSnapshot({
  ticker,
  priceData,
  optionsData,
  gamma,
  skew,
  atmIV,
  putCallVolRatio,
  impliedMove,
  maxPain,
  putCallOIRatio,
  totalDelta,
  gammaWalls,
  ivTerm,
  zeroGammaLevel,
  multipleExpectedMoves,
  totalVega,
  vanna
}) {
  if (!isMetricsLoggingEnabled() || !ticker) {
    return false;
  }

  try {
    const client = getSupabaseClient();
    
    // Determine data freshness
    let dataFreshness = 'unavailable';
    let cachedMinutesAgo = null;
    
    if (optionsData && !optionsData.unavailable) {
      if (optionsData.isStale) {
        dataFreshness = 'stale';
        // Calculate age from fetchedAt
        if (optionsData.fetchedAt) {
          const ageMs = Date.now() - new Date(optionsData.fetchedAt).getTime();
          cachedMinutesAgo = Math.floor(ageMs / 60000);
        }
      } else {
        dataFreshness = 'fresh';
        cachedMinutesAgo = 0;
      }
    }
    
    // Build snapshot record
    const snapshot = {
      ticker: ticker.toUpperCase(),
      spot_price: priceData?.currentPrice || optionsData?.spot || null,
      price_change: priceData?.change || null,
      price_change_pct: priceData?.changePercent || null,
      
      // Dealer Gamma
      dealer_gamma_value: gamma.unavailable ? null : Math.abs(gamma.gammaNotional),
      dealer_gamma_direction: gamma.unavailable ? null : gamma.interpretation,
      
      // Skew
      skew_value: skew.unavailable ? null : skew.skewPP,
      
      // ATM IV
      atm_iv_value: atmIV?.percent || null,
      atm_iv_strike: atmIV?.strike || null,
      
      // Put/Call Volume Ratio
      put_call_volume_ratio: putCallVolRatio?.ratio || null,
      
      // Implied Move
      implied_move_dollars: impliedMove?.abs || null,
      implied_move_pct: impliedMove?.pct || null,
      
      // Max Pain
      max_pain: maxPain?.strike || null,
      
      // Put/Call OI Ratio
      put_call_oi_ratio: putCallOIRatio?.ratio || null,
      
      // Total Delta
      total_delta_value: totalDelta?.value || null,
      
      // Gamma Walls (top 3)
      gamma_walls: gammaWalls ? gammaWalls.slice(0, 3).map(w => ({
        strike: w.strike,
        gamma_notional: w.gamma
      })) : null,
      
      // IV Term Structure
      iv_term_front: ivTerm?.front || null,
      iv_term_back: ivTerm?.back || null,
      
      // Zero Gamma Level
      zero_gamma_level: zeroGammaLevel?.level || null,
      
      // Multiple Expected Moves
      multiple_expected_moves: multipleExpectedMoves ? multipleExpectedMoves.map(m => ({
        days: m.days,
        move_dollars: m.move,
        move_pct: m.movePercent
      })) : null,
      
      // Total Vega
      total_vega_value: totalVega?.value || null,
      
      // Vanna
      vanna_value: vanna?.value || null,
      
      // Metadata
      data_freshness: dataFreshness,
      cached_minutes_ago: cachedMinutesAgo,
      
      recorded_at: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0] // YYYY-MM-DD
    };
    
    // Upsert (insert or update if exists for today)
    const { error } = await client
      .from('metrics_history')
      .upsert(snapshot, {
        onConflict: 'ticker,date',
        ignoreDuplicates: false
      });
    
    if (error) {
      console.error(`[MetricsLogger] Error logging ${ticker}:`, error.message);
      return false;
    }
    
    console.log(`[MetricsLogger] ✅ Logged snapshot for ${ticker} (${dataFreshness})`);
    return true;
  } catch (err) {
    console.error(`[MetricsLogger] Exception logging ${ticker}:`, err);
    return false;
  }
}

/**
 * Get historical metrics for a ticker
 * 
 * @param {string} ticker - Stock ticker symbol
 * @param {number} days - Number of days to retrieve (default: 30)
 * @returns {Promise<Array>} Array of metric snapshots
 */
export async function getMetricsHistory(ticker, days = 30) {
  if (!isMetricsLoggingEnabled()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('metrics_history')
      .select('*')
      .eq('ticker', ticker.toUpperCase())
      .order('date', { ascending: false })
      .limit(days);
    
    if (error) {
      console.error(`[MetricsLogger] Error fetching history for ${ticker}:`, error);
      return [];
    }
    
    return data || [];
  } catch (err) {
    console.error(`[MetricsLogger] Exception fetching history for ${ticker}:`, err);
    return [];
  }
}

/**
 * Get metrics for all tickers on a specific date
 * 
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<Array>} Array of metric snapshots
 */
export async function getMetricsByDate(date) {
  if (!isMetricsLoggingEnabled()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('metrics_history')
      .select('*')
      .eq('date', date)
      .order('ticker');
    
    if (error) {
      console.error(`[MetricsLogger] Error fetching metrics for ${date}:`, error);
      return [];
    }
    
    return data || [];
  } catch (err) {
    console.error(`[MetricsLogger] Exception fetching metrics for ${date}:`, err);
    return [];
  }
}

/**
 * Get metrics logging statistics
 * 
 * @returns {Promise<{total_snapshots: number, unique_tickers: number, date_range: Object}>}
 */
export async function getMetricsStats() {
  if (!isMetricsLoggingEnabled()) {
    return { total_snapshots: 0, unique_tickers: 0, date_range: null };
  }

  try {
    const client = getSupabaseClient();
    
    // Total snapshots
    const { count } = await client
      .from('metrics_history')
      .select('*', { count: 'exact', head: true });
    
    // Unique tickers
    const { data: tickers } = await client
      .from('metrics_history')
      .select('ticker')
      .limit(1000);
    
    const uniqueTickers = tickers ? new Set(tickers.map(t => t.ticker)).size : 0;
    
    // Date range
    const { data: dateRange } = await client
      .from('metrics_history')
      .select('date')
      .order('date', { ascending: true })
      .limit(1);
    
    const { data: dateRangeEnd } = await client
      .from('metrics_history')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
    
    return {
      total_snapshots: count || 0,
      unique_tickers: uniqueTickers,
      date_range: {
        start: dateRange?.[0]?.date || null,
        end: dateRangeEnd?.[0]?.date || null
      }
    };
  } catch (err) {
    console.error('[MetricsLogger] Exception getting stats:', err);
    return { total_snapshots: 0, unique_tickers: 0, date_range: null };
  }
}

