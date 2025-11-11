/**
 * Production-Ready Backfill Script
 * 
 * Backfills historical metrics data into Supabase metrics_history table.
 * 
 * ⚠️  IMPORTANT LIMITATION:
 * Polygon.io does NOT provide historical options data for past dates.
 * Their snapshot endpoint only returns current/live options data.
 * 
 * This script:
 * - Uses current options snapshots from Polygon
 * - Fetches historical stock prices for past dates
 * - Calculates metrics using current options data (as best approximation)
 * - Marks data with 'backfilled' flag in data_freshness field
 * 
 * For TRUE historical options data, you would need:
 * - CBOE historical options feed
 * - Bloomberg Terminal data
 * - Or another provider with historical options chains
 * 
 * Usage:
 *   node backfill_history.js
 *   node backfill_history.js --days=30
 *   node backfill_history.js --days=30 --tickers=SPY,QQQ,AAPL
 * 
 * Features:
 * - Skip weekends automatically
 * - Rate limiting: 12 seconds between requests (Polygon: 5/min)
 * - Error handling with retry logic (3 attempts per date)
 * - Progress tracking with console output
 * - Resume capability (checks existing dates, skips them)
 * - Marks backfilled data with metadata flag
 * - Logs errors to backfill_errors.log
 */

import dotenv from 'dotenv';
// Load environment variables FIRST before any other imports
dotenv.config();

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Import metrics calculation - note: these are not exported, so we'll recreate simplified versions
// In production, you may want to refactor polygonProvider to export these functions

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const POLYGON_BASE_URL = 'https://api.polygon.io';
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

// Default tickers
const DEFAULT_TICKERS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT'];

// Rate limiting: 12 seconds between requests (5 requests/min max)
const RATE_LIMIT_MS = 12000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// Error log file
const ERROR_LOG = path.join(__dirname, 'backfill_errors.log');

/**
 * Log error to file and console
 */
function logError(message, error = null) {
  const timestamp = new Date().toISOString();
  const errorMsg = error ? `${message}: ${error.message || error}` : message;
  const logLine = `[${timestamp}] ${errorMsg}\n`;
  
  fs.appendFileSync(ERROR_LOG, logLine);
  console.error(`❌ ${errorMsg}`);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if date is a weekend
 */
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Get list of dates to process (excluding weekends)
 */
function getDatesToProcess(days) {
  const dates = [];
  const today = new Date();
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    
    if (!isWeekend(date)) {
      dates.push(date);
    }
  }
  
  return dates;
}

/**
 * Initialize Supabase client
 */
function getSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

/**
 * Check which dates already exist in Supabase for a ticker
 */
async function getExistingDates(supabase, ticker) {
  try {
    const { data, error } = await supabase
      .from('metrics_history')
      .select('date')
      .eq('ticker', ticker.toUpperCase())
      .order('date', { ascending: false });
    
    if (error) throw error;
    
    return new Set((data || []).map(row => row.date));
  } catch (error) {
    logError(`Failed to check existing dates for ${ticker}`, error);
    return new Set(); // Return empty set on error, will try to backfill anyway
  }
}

/**
 * Fetch stock price for a specific date
 * Uses Polygon's aggregates endpoint to get historical price for that date
 */
async function fetchPriceForDate(symbol, targetDate) {
  try {
    const dateStr = formatDate(targetDate);
    
    // Fetch aggregates for the specific date (daily bar)
    // Note: If date is a weekend, this will return previous trading day
    const priceUrl = `${POLYGON_BASE_URL}/v2/aggs/ticker/${symbol}/range/1/day/${dateStr}/${dateStr}?adjusted=true&apiKey=${POLYGON_API_KEY}`;
    const response = await fetch(priceUrl, { timeout: 10000 });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // If no data for that date, try previous trading day
    if (!data.results || data.results.length === 0) {
      // Fallback to previous close
      const prevUrl = `${POLYGON_BASE_URL}/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
      const prevResponse = await fetch(prevUrl, { timeout: 10000 });
      
      if (prevResponse.ok) {
        const prevData = await prevResponse.json();
        const price = prevData.results?.[0]?.c;
        if (price) {
          return price;
        }
      }
      
      throw new Error(`No price data found for ${dateStr}`);
    }
    
    // Use close price for that day
    const price = data.results[0].c; // Close price
    
    if (!price) {
      throw new Error('No close price in response');
    }
    
    return price;
  } catch (error) {
    throw new Error(`Failed to fetch price for ${formatDate(targetDate)}: ${error.message}`);
  }
}

/**
 * Fetch options data from Polygon (current snapshot only)
 * 
 * ⚠️  LIMITATION: Polygon.io does NOT provide historical options for past dates.
 * This function always fetches the current/live options snapshot.
 * For true historical backfill, you'd need a different data provider.
 */
async function fetchOptionsData(symbol) {
  try {
    const snapshotUrl = `${POLYGON_BASE_URL}/v3/snapshot/options/${symbol}?limit=250&apiKey=${POLYGON_API_KEY}`;
    const response = await fetch(snapshotUrl, { timeout: 15000 });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    let optionsData = await response.json();
    let allContracts = optionsData.results || [];
    
    // Fetch additional pages if available
    let pageCount = 1;
    while (optionsData.next_url && pageCount < 3) {
      await sleep(1000); // Small delay between pages
      const nextUrl = `${optionsData.next_url}&apiKey=${POLYGON_API_KEY}`;
      const nextResponse = await fetch(nextUrl, { timeout: 15000 });
      
      if (nextResponse.ok) {
        optionsData = await nextResponse.json();
        allContracts = allContracts.concat(optionsData.results || []);
        pageCount++;
      } else {
        break;
      }
    }
    
    return allContracts;
  } catch (error) {
    throw new Error(`Failed to fetch options: ${error.message}`);
  }
}

/**
 * Process Polygon options into standard format
 */
function processPolygonOptions(contracts, spot, targetDate) {
  const rows = [];
  const now = new Date(targetDate).getTime(); // Use target date as reference
  const maxDays = 30;

  for (const opt of contracts) {
    try {
      const details = opt.details;
      if (!details || !details.expiration_date) continue;

      const expiryDate = new Date(details.expiration_date);
      const ttmDays = (expiryDate - now) / (1000 * 60 * 60 * 24);

      // Only include options within 30 days of target date
      if (ttmDays <= 0 || ttmDays > maxDays) continue;

      if (!opt.implied_volatility || opt.implied_volatility <= 0) continue;
      if (!details.strike_price || details.strike_price <= 0) continue;

      rows.push({
        expiryUTC: expiryDate.toISOString(),
        ttmDays: Math.round(ttmDays * 100) / 100,
        strike: Math.round(details.strike_price * 100) / 100,
        type: details.contract_type === 'call' ? 'call' : 'put',
        iv: Math.round(opt.implied_volatility * 10000) / 10000,
        oi: opt.open_interest || 0,
        volume: opt.day?.volume || 0,
        bid: opt.last_quote?.bid || 0,
        ask: opt.last_quote?.ask || 0,
        lastPrice: opt.day?.close || 0
      });
    } catch (err) {
      continue;
    }
  }

  return rows;
}

/**
 * Black-Scholes helper functions
 */
function normalPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const probability = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - probability : probability;
}

function calculateDelta(spot, strike, ttmYears, iv, isCall) {
  if (ttmYears <= 0 || iv <= 0) return 0;
  const d1 = (Math.log(spot / strike) + (0.5 * iv * iv) * ttmYears) / (iv * Math.sqrt(ttmYears));
  return isCall ? normalCDF(d1) : normalCDF(d1) - 1;
}

function calculateVega(spot, strike, ttmYears, iv) {
  if (ttmYears <= 0 || iv <= 0) return 0;
  const d1 = (Math.log(spot / strike) + (0.5 * iv * iv) * ttmYears) / (iv * Math.sqrt(ttmYears));
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return (spot * pdf * Math.sqrt(ttmYears)) / 100;
}

function calculateVanna(spot, strike, ttmYears, iv) {
  if (ttmYears <= 0 || iv <= 0) return 0;
  const d1 = (Math.log(spot / strike) + (0.5 * iv * iv) * ttmYears) / (iv * Math.sqrt(ttmYears));
  const d2 = d1 - iv * Math.sqrt(ttmYears);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return -(pdf * d2) / iv;
}

/**
 * Calculate dealer gamma (matching polygonProvider logic)
 * @param {Array} rows - Options rows
 * @param {number} spot - Spot price
 * @param {number} referenceTimestamp - Reference time for TTM calculation (default: now)
 */
function calculateDealerGammaForDate(rows, spot, referenceTimestamp = Date.now()) {
  if (!rows || rows.length === 0 || !spot) {
    return { unavailable: true };
  }
  
  let totalGamma = 0;

  for (const row of rows) {
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - referenceTimestamp) / (1000 * 60 * 60 * 24 * 365.25);
    
    if (ttmYears <= 0 || row.iv <= 0 || row.oi <= 0) continue;

    const d1 = (Math.log(spot / row.strike) + (0.5 * row.iv * row.iv) * ttmYears) / (row.iv * Math.sqrt(ttmYears));
    const gamma = normalPDF(d1) / (spot * row.iv * Math.sqrt(ttmYears));
    const dollarGamma = gamma * spot * spot * 100 * row.oi;
    
    totalGamma += dollarGamma;
  }

  if (totalGamma === 0) {
    return { unavailable: true };
  }

  const dealerGamma = -totalGamma;
  const gammaInBillions = dealerGamma / 1e9;
  const sign = dealerGamma < 0 ? 'short' : 'long';

  return {
    unavailable: false,
    value: gammaInBillions,
    sign,
    formatted: `${gammaInBillions > 0 ? '+' : ''}$${Math.abs(gammaInBillions).toFixed(1)}B (${sign})`
  };
}

function calculateSkew(rows, spot) {
  if (!rows || rows.length === 0 || !spot) {
    return { unavailable: true };
  }

  const putStrike = spot * 0.9;
  const callStrike = spot * 1.1;

  const findIV = (options, targetStrike) => {
    const sorted = options
      .filter(o => o.iv > 0)
      .sort((a, b) => a.strike - b.strike);

    if (sorted.length === 0) return null;

    let lower = null, upper = null;
    for (const opt of sorted) {
      if (opt.strike <= targetStrike) lower = opt;
      if (opt.strike >= targetStrike && !upper) upper = opt;
    }

    if (!lower && !upper) return null;
    if (!lower) return upper.iv;
    if (!upper) return lower.iv;
    if (lower.strike === upper.strike) return lower.iv;

    const weight = (targetStrike - lower.strike) / (upper.strike - lower.strike);
    return lower.iv + weight * (upper.iv - lower.iv);
  };

  const puts = rows.filter(r => r.type === 'put');
  const calls = rows.filter(r => r.type === 'call');

  const putIV = findIV(puts, putStrike);
  const callIV = findIV(calls, callStrike);

  if (!putIV || !callIV) {
    return { unavailable: true };
  }

  const skew = (putIV - callIV) * 100;

  return {
    unavailable: false,
    value: skew,
    skewPP: skew,
    formatted: `${skew.toFixed(1)} pp`,
    putIV: (putIV * 100).toFixed(1),
    callIV: (callIV * 100).toFixed(1)
  };
}

/**
 * Calculate all 14 quant metrics (full implementation matching polygonProvider)
 * @param {Array} rows - Options rows
 * @param {number} spot - Spot price
 * @param {number} referenceTimestamp - Reference time for TTM calculation (default: now)
 */
function calculateAllMetricsForDate(rows, spot, referenceTimestamp = Date.now()) {
  if (!rows || rows.length === 0 || !spot) {
    return {
      atmIV: null,
      putCallVolumeRatio: null,
      impliedMove: null,
      maxPain: null,
      putCallOIRatio: null,
      totalDelta: null,
      gammaWalls: null,
      ivTermStructure: null,
      zeroGammaLevel: null,
      multipleExpectedMoves: null,
      totalVega: null,
      vanna: null
    };
  }

  const expiries = [...new Set(rows.map(r => r.expiryUTC))].sort();
  if (expiries.length === 0) {
    return {
      atmIV: null, putCallVolumeRatio: null, impliedMove: null,
      maxPain: null, putCallOIRatio: null, totalDelta: null,
      gammaWalls: null, ivTermStructure: null, zeroGammaLevel: null,
      multipleExpectedMoves: null, totalVega: null, vanna: null
    };
  }

  const nearestExpiry = expiries[0];
  const expiryRows = rows.filter(r => r.expiryUTC === nearestExpiry);
  const strikes = [...new Set(expiryRows.map(r => r.strike))].sort((a, b) => a - b);
  const atmStrike = strikes.reduce((prev, curr) => 
    Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev
  );

  // 1. ATM IV
  let atmIV = null;
  const atmCall = expiryRows.find(r => r.strike === atmStrike && r.type === 'call');
  const atmPut = expiryRows.find(r => r.strike === atmStrike && r.type === 'put');
  if (atmCall && atmPut) {
    const avgIV = (atmCall.iv + atmPut.iv) / 2;
    atmIV = {
      percent: Math.round(avgIV * 100 * 10) / 10,
      decimal: Math.round(avgIV * 10000) / 10000,
      strike: atmStrike
    };
  } else if (atmCall) {
    atmIV = {
      percent: Math.round(atmCall.iv * 100 * 10) / 10,
      decimal: Math.round(atmCall.iv * 10000) / 10000,
      strike: atmStrike
    };
  } else if (atmPut) {
    atmIV = {
      percent: Math.round(atmPut.iv * 100 * 10) / 10,
      decimal: Math.round(atmPut.iv * 10000) / 10000,
      strike: atmStrike
    };
  }

  // 2. Put/Call Volume Ratio
  let putCallVolumeRatio = null;
  const totalCallVol = expiryRows.filter(r => r.type === 'call').reduce((sum, r) => sum + r.volume, 0);
  const totalPutVol = expiryRows.filter(r => r.type === 'put').reduce((sum, r) => sum + r.volume, 0);
  if (totalCallVol > 0) {
    putCallVolumeRatio = {
      ratio: Math.round((totalPutVol / totalCallVol) * 100) / 100,
      window: 'expiry'
    };
  }

  // 3. Implied Move
  let impliedMove = null;
  if (atmCall && atmPut) {
    const callMid = (atmCall.bid > 0 && atmCall.ask > 0) ? (atmCall.bid + atmCall.ask) / 2 : atmCall.lastPrice;
    const putMid = (atmPut.bid > 0 && atmPut.ask > 0) ? (atmPut.bid + atmPut.ask) / 2 : atmPut.lastPrice;
    if (callMid > 0 && putMid > 0) {
      const straddle = callMid + putMid;
      impliedMove = {
        abs: Math.round(straddle * 100) / 100,
        pct: Math.round((straddle / spot) * 100 * 10) / 10,
        expiry: nearestExpiry
      };
    }
  }

  // 4. Put/Call OI Ratio
  let putCallOIRatio = null;
  const totalCallOI = expiryRows.filter(r => r.type === 'call').reduce((sum, r) => sum + r.oi, 0);
  const totalPutOI = expiryRows.filter(r => r.type === 'put').reduce((sum, r) => sum + r.oi, 0);
  if (totalCallOI > 0) {
    putCallOIRatio = {
      ratio: Math.round((totalPutOI / totalCallOI) * 100) / 100,
      callOI: totalCallOI,
      putOI: totalPutOI
    };
  }

  // 5. Max Pain
  let maxPain = null;
  const strikeValues = {};
  for (const row of expiryRows) {
    if (!strikeValues[row.strike]) strikeValues[row.strike] = 0;
    for (const testRow of expiryRows) {
      const intrinsic = testRow.type === 'call' 
        ? Math.max(0, row.strike - testRow.strike)
        : Math.max(0, testRow.strike - row.strike);
      strikeValues[row.strike] += intrinsic * testRow.oi * 100;
    }
  }
  if (Object.keys(strikeValues).length > 0) {
    const maxPainStrike = Object.keys(strikeValues).reduce((a, b) => 
      strikeValues[a] < strikeValues[b] ? a : b
    );
    const totalOI = totalCallOI + totalPutOI;
    maxPain = {
      strike: parseFloat(maxPainStrike),
      totalOI: Math.round(totalOI),
      totalValue: Math.round(strikeValues[maxPainStrike] / 1e9 * 10) / 10
    };
  }

  // 6. Total Delta
  let totalDelta = null;
  let netDelta = 0;
  for (const row of rows.filter(r => r.oi > 0)) {
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - referenceTimestamp) / (1000 * 60 * 60 * 24 * 365.25);
    if (ttmYears > 0) {
      const delta = calculateDelta(spot, row.strike, ttmYears, row.iv, row.type === 'call');
      netDelta += delta * row.oi * 100 * spot;
    }
  }
  totalDelta = {
    value: Math.round(netDelta / 1e6),
    formatted: `${netDelta > 0 ? '+' : ''}$${Math.round(Math.abs(netDelta) / 1e6)}M`,
    bias: netDelta > 0 ? 'bullish' : netDelta < 0 ? 'bearish' : 'neutral'
  };

  // 7. Gamma Walls
  let gammaWalls = null;
  const gammaByStrike = {};
  for (const row of expiryRows) {
    if (!gammaByStrike[row.strike]) gammaByStrike[row.strike] = 0;
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - referenceTimestamp) / (1000 * 60 * 60 * 24 * 365.25);
    if (ttmYears > 0 && row.iv > 0) {
      const d1 = (Math.log(spot / row.strike) + (0.5 * row.iv * row.iv) * ttmYears) / (row.iv * Math.sqrt(ttmYears));
      const gamma = normalPDF(d1) / (spot * row.iv * Math.sqrt(ttmYears));
      const dollarGamma = gamma * spot * spot * 100 * row.oi;
      gammaByStrike[row.strike] += dollarGamma;
    }
  }
  const sortedGamma = Object.entries(gammaByStrike)
    .map(([strike, gamma]) => ({ strike: parseFloat(strike), gamma }))
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))
    .slice(0, 3);
  if (sortedGamma.length > 0) {
    gammaWalls = sortedGamma.map(g => ({
      strike: g.strike,
      gamma: Math.round(g.gamma / 1e9 * 10) / 10,
      formatted: `$${g.strike} (${g.gamma > 0 ? '+' : ''}$${Math.round(Math.abs(g.gamma) / 1e9 * 10) / 10}B)`
    }));
  }

  // 8. IV Term Structure
  let ivTermStructure = null;
  if (expiries.length >= 2) {
    const nearExpiry = expiries[0];
    const farExpiry = expiries[expiries.length - 1];
    const nearRows = rows.filter(r => r.expiryUTC === nearExpiry && r.oi > 0);
    const farRows = rows.filter(r => r.expiryUTC === farExpiry && r.oi > 0);
    if (nearRows.length > 0 && farRows.length > 0) {
      const nearIV = nearRows.reduce((sum, r) => sum + r.iv * r.oi, 0) / nearRows.reduce((sum, r) => sum + r.oi, 0);
      const farIV = farRows.reduce((sum, r) => sum + r.iv * r.oi, 0) / farRows.reduce((sum, r) => sum + r.oi, 0);
      ivTermStructure = {
        front: Math.round(nearIV * 100 * 10) / 10,
        back: Math.round(farIV * 100 * 10) / 10,
        spread: Math.round((nearIV - farIV) * 100 * 10) / 10,
        structure: nearIV > farIV ? 'backwardation' : 'contango'
      };
    }
  }

  // 9. Zero Gamma Level
  let zeroGammaLevel = null;
  const testStrikes = strikes.filter(s => s > spot * 0.9 && s < spot * 1.1);
  if (testStrikes.length >= 2) {
    let closestStrike = testStrikes[0];
    let minGammaDiff = Infinity;
    for (const testStrike of testStrikes) {
      let netGamma = 0;
      for (const row of expiryRows) {
        const expiryDate = new Date(row.expiryUTC);
        const ttmYears = (expiryDate - referenceTimestamp) / (1000 * 60 * 60 * 24 * 365.25);
        if (ttmYears > 0 && row.iv > 0) {
          const d1 = (Math.log(testStrike / row.strike) + (0.5 * row.iv * row.iv) * ttmYears) / (row.iv * Math.sqrt(ttmYears));
          const gamma = normalPDF(d1) / (Math.sqrt(2 * Math.PI) * testStrike * row.iv * Math.sqrt(ttmYears));
          netGamma += gamma * testStrike * testStrike * 100 * row.oi;
        }
      }
      if (Math.abs(netGamma) < minGammaDiff) {
        minGammaDiff = Math.abs(netGamma);
        closestStrike = testStrike;
      }
    }
    zeroGammaLevel = {
      level: closestStrike,
      aboveSpot: closestStrike > spot,
      formatted: `$${closestStrike} (${closestStrike > spot ? 'above' : 'below'} spot)`
    };
  }

  // 10. Multiple Expected Moves
  let multipleExpectedMoves = null;
  if (expiries.length >= 1) {
    const moves = [];
    for (let i = 0; i < Math.min(3, expiries.length); i++) {
      const expiry = expiries[i];
      const expiryDate = new Date(expiry);
      const ttmYears = (expiryDate - referenceTimestamp) / (1000 * 60 * 60 * 24 * 365.25);
      const daysToExpiry = Math.round((expiryDate - referenceTimestamp) / (1000 * 60 * 60 * 24));
      if (ttmYears > 0) {
        const expiryRows = rows.filter(r => r.expiryUTC === expiry && r.oi > 0 && r.iv > 0);
        const atmRows = expiryRows.filter(r => Math.abs(r.strike - spot) < spot * 0.05);
        if (atmRows.length > 0) {
          const totalOI = atmRows.reduce((sum, r) => sum + r.oi, 0);
          const atmIVForExpiry = atmRows.reduce((sum, r) => sum + r.iv * r.oi, 0) / totalOI;
          if (atmIVForExpiry > 0 && !isNaN(atmIVForExpiry)) {
            const expectedMove = spot * atmIVForExpiry * Math.sqrt(ttmYears);
            moves.push({
              expiry: expiryDate.toISOString().split('T')[0],
              days: daysToExpiry,
              move: Math.round(expectedMove * 10) / 10,
              movePercent: Math.round(expectedMove / spot * 1000) / 10,
              upper: Math.round((spot + expectedMove) * 100) / 100,
              lower: Math.round((spot - expectedMove) * 100) / 100
            });
          }
        }
      }
    }
    if (moves.length > 0) {
      multipleExpectedMoves = moves;
    }
  }

  // 11. Total Vega
  let totalVega = null;
  let netVega = 0;
  for (const row of rows.filter(r => r.oi > 0)) {
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - referenceTimestamp) / (1000 * 60 * 60 * 24 * 365.25);
    if (ttmYears > 0 && row.iv > 0) {
      const vega = calculateVega(spot, row.strike, ttmYears, row.iv);
      netVega += vega * row.oi * 100;
    }
  }
  totalVega = {
    value: Math.round(netVega / 1e6),
    formatted: `${netVega > 0 ? '+' : ''}$${Math.round(Math.abs(netVega) / 1e6)}M per 1% IV`,
    bias: netVega > 0 ? 'long volatility' : netVega < 0 ? 'short volatility' : 'neutral'
  };

  // 12. Vanna
  let vanna = null;
  let netVanna = 0;
  for (const row of rows.filter(r => r.oi > 0)) {
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - referenceTimestamp) / (1000 * 60 * 60 * 24 * 365.25);
    if (ttmYears > 0 && row.iv > 0) {
      const vannaValue = calculateVanna(spot, row.strike, ttmYears, row.iv);
      netVanna += vannaValue * row.oi * 100 * spot;
    }
  }
  vanna = {
    value: Math.round(netVanna / 1e6),
    formatted: `${netVanna > 0 ? '+' : ''}$${Math.round(Math.abs(netVanna) / 1e6)}M`,
    interpretation: netVanna > 0 
      ? 'Rising IV increases delta (bullish convexity)' 
      : netVanna < 0 
        ? 'Rising IV decreases delta (bearish convexity)'
        : 'Neutral vanna'
  };

  return {
    atmIV,
    putCallVolumeRatio,
    impliedMove,
    maxPain,
    putCallOIRatio,
    totalDelta,
    gammaWalls,
    ivTermStructure,
    zeroGammaLevel,
    multipleExpectedMoves,
    totalVega,
    vanna
  };
}

/**
 * Backfill a single date for a ticker
 */
async function backfillDate(supabase, ticker, date, retryCount = 0) {
  const dateStr = formatDate(date);
  const targetTimestamp = date.getTime(); // Use target date as reference
  
  try {
    // Fetch price and options data
    const [spot, contracts] = await Promise.all([
      fetchPriceForDate(ticker, date),
      fetchOptionsData(ticker)
    ]);

    if (!spot || !contracts || contracts.length === 0) {
      throw new Error(`Insufficient data: spot=${spot}, contracts=${contracts?.length || 0}`);
    }

    // Process options using target date as reference
    const rows = processPolygonOptions(contracts, spot, date);
    
    if (rows.length < 10) {
      throw new Error(`Too few valid options contracts: ${rows.length}`);
    }

    // Calculate all metrics (pass target timestamp for accurate TTM calculations)
    const gamma = calculateDealerGammaForDate(rows, spot, targetTimestamp);
    const skew = calculateSkew(rows, spot);
    const otherMetrics = calculateAllMetricsForDate(rows, spot, targetTimestamp);

    // Build snapshot record
    const snapshot = {
      ticker: ticker.toUpperCase(),
      date: dateStr,
      spot_price: spot,
      price_change: null, // Not available for historical
      price_change_pct: null,
      
      dealer_gamma_value: gamma.unavailable ? null : Math.abs(gamma.value || 0),
      dealer_gamma_direction: gamma.unavailable ? null : gamma.sign,
      
      skew_value: skew.unavailable ? null : skew.value,
      
      atm_iv_value: otherMetrics.atmIV?.percent || null,
      atm_iv_strike: otherMetrics.atmIV?.strike || null,
      
      put_call_volume_ratio: otherMetrics.putCallVolumeRatio?.ratio || null,
      
      implied_move_dollars: otherMetrics.impliedMove?.abs || null,
      implied_move_pct: otherMetrics.impliedMove?.pct || null,
      
      max_pain: otherMetrics.maxPain?.strike || null,
      
      put_call_oi_ratio: otherMetrics.putCallOIRatio?.ratio || null,
      
      total_delta_value: otherMetrics.totalDelta?.value || null,
      
      gamma_walls: otherMetrics.gammaWalls ? otherMetrics.gammaWalls.slice(0, 3).map(w => ({
        strike: w.strike,
        gamma_notional: w.gamma
      })) : null,
      
      iv_term_front: otherMetrics.ivTermStructure?.front || null,
      iv_term_back: otherMetrics.ivTermStructure?.back || null,
      
      zero_gamma_level: otherMetrics.zeroGammaLevel?.level || null,
      
      multiple_expected_moves: otherMetrics.multipleExpectedMoves ? otherMetrics.multipleExpectedMoves.map(m => ({
        days: m.days,
        move_dollars: m.move,
        move_pct: m.movePercent
      })) : null,
      
      total_vega_value: otherMetrics.totalVega?.value || null,
      
      vanna_value: otherMetrics.vanna?.value || null,
      
      data_freshness: 'backfilled', // Special flag to indicate backfilled data
      cached_minutes_ago: null,
      recorded_at: new Date().toISOString()
      // Note: 'backfilled' is stored in data_freshness field to distinguish from regular data
    };

    // Upsert to Supabase
    const { error } = await supabase
      .from('metrics_history')
      .upsert(snapshot, {
        onConflict: 'ticker,date',
        ignoreDuplicates: false
      });

    if (error) throw error;

    // Format success message
    const gammaStr = !gamma.unavailable ? `Dealer Gamma: ${gamma.formatted}` : '';
    const skewStr = !skew.unavailable ? ` | Skew: ${skew.formatted}` : '';
    const metricsStr = `${gammaStr}${skewStr}`.trim();

    return { success: true, metricsStr };
    
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS);
      return backfillDate(supabase, ticker, date, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Main backfill function
 */
async function backfillTicker(supabase, ticker, dates) {
  console.log(`📊 Backfilling ${ticker}...`);
  
  // Check existing dates
  const existingDates = await getExistingDates(supabase, ticker);
  
  const results = {
    success: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  for (const date of dates) {
    const dateStr = formatDate(date);
    
    // Skip if already exists
    if (existingDates.has(dateStr)) {
      results.skipped++;
      continue;
    }

    // Skip weekends
    if (isWeekend(date)) {
      results.skipped++;
      console.log(`⏭️  ${ticker} ${dateStr} (weekend - skipped)`);
      continue;
    }

    try {
      const result = await backfillDate(supabase, ticker, date);
      
      if (result.success) {
        results.success++;
        console.log(`✅ ${ticker} ${dateStr} | ${result.metricsStr}`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push({ date: dateStr, error: error.message });
      logError(`${ticker} ${dateStr}`, error);
      
      if (results.errors.length <= 3) {
        console.log(`❌ ${ticker} ${dateStr} (failed: ${error.message.substring(0, 50)})`);
      }
    }

    // Rate limiting
    await sleep(RATE_LIMIT_MS);
  }

  const totalDates = dates.filter(d => !isWeekend(d)).length;
  const weekendCount = dates.length - totalDates;
  
  console.log(`✅ Completed ${ticker}: ${results.success}/${totalDates} days (skipped ${weekendCount} weekends, ${results.skipped} existing, ${results.failed} failed)`);
  
  return results;
}

/**
 * Main entry point
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let days = 30;
  let tickers = DEFAULT_TICKERS;

  for (const arg of args) {
    if (arg.startsWith('--days=')) {
      days = parseInt(arg.split('=')[1]) || 30;
    } else if (arg.startsWith('--tickers=')) {
      tickers = arg.split('=')[1].split(',').map(t => t.trim().toUpperCase());
    }
  }

  // Validate environment
  if (!POLYGON_API_KEY) {
    console.error('❌ POLYGON_API_KEY not set');
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ SUPABASE_URL and SUPABASE_ANON_KEY must be set');
    process.exit(1);
  }

  // Initialize
  const supabase = getSupabaseClient();
  const dates = getDatesToProcess(days);
  const startTime = Date.now();

  console.log('========================================');
  console.log('🚀 Starting backfill');
  console.log('========================================');
  console.log(`Days: ${days} (${dates.length} weekdays)`);
  console.log(`Tickers: ${tickers.join(', ')}`);
  console.log(`Date range: ${formatDate(dates[0])} to ${formatDate(dates[dates.length - 1])}`);
  console.log(`Rate limit: ${RATE_LIMIT_MS / 1000}s between requests`);
  console.log('========================================');
  console.log('');

  // Clear error log
  if (fs.existsSync(ERROR_LOG)) {
    fs.writeFileSync(ERROR_LOG, '');
  }

  const allResults = {
    total: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    tickerResults: {}
  };

  // Process each ticker
  for (const ticker of tickers) {
    try {
      const results = await backfillTicker(supabase, ticker, dates);
      allResults.total += dates.length;
      allResults.success += results.success;
      allResults.skipped += results.skipped;
      allResults.failed += results.failed;
      allResults.tickerResults[ticker] = results;
      
      console.log(''); // Blank line between tickers
    } catch (error) {
      logError(`Fatal error processing ${ticker}`, error);
      console.log('');
    }
  }

  // Final summary
  const runtime = Math.round((Date.now() - startTime) / 1000 / 60);
  
  console.log('========================================');
  console.log('🎉 Backfill complete!');
  console.log('========================================');
  console.log(`Total records inserted: ${allResults.success}`);
  console.log(`Skipped (existing/weekends): ${allResults.skipped}`);
  console.log(`Failed: ${allResults.failed}`);
  if (allResults.failed > 0) {
    console.log(`Errors logged to: ${ERROR_LOG}`);
  }
  console.log(`Runtime: ${runtime} minutes`);
  console.log('========================================');

  // Exit with error code if all failed
  if (allResults.success === 0 && allResults.failed > 0) {
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  main().catch(error => {
    logError('Fatal error in main', error);
    process.exit(1);
  });
}

export { backfillTicker, backfillDate };

