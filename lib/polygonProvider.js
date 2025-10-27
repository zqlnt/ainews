/**
 * Polygon.io Options Data Provider
 * Fetches options chains directly from Polygon.io REST API
 * No Python bridge needed - pure Node.js
 */

import fetch from 'node-fetch';

// Read API key inside functions to avoid hoisting issues with ES modules
const POLYGON_BASE_URL = 'https://api.polygon.io';

// In-memory cache (same as yfinance provider)
const optionsCache = new Map();
const OPT_CACHE_TTL_SEC = parseInt(process.env.OPT_CACHE_TTL_SEC || '14400'); // 4 hours
const OPT_STALE_TTL_SEC = parseInt(process.env.OPT_STALE_TTL_SEC || '86400'); // 24 hours

/**
 * Fetch options data from Polygon.io
 * @param {string} symbol - Stock symbol
 * @returns {Promise<{spot: number|null, rows: Array, fetchedAt: string}>}
 */
export async function fetchPolygonOptions(symbol) {
  // Read API key at runtime to avoid ES module hoisting issues
  const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
  
  if (!POLYGON_API_KEY) {
    console.log(`[${new Date().toISOString()}] ⚠️  POLYGON_API_KEY not set`);
    return { spot: null, rows: [], fetchedAt: new Date().toISOString() };
  }

  // Check cache
  const cacheKey = `${symbol}:polygon`;
  const cached = optionsCache.get(cacheKey);
  const now = Date.now();
  
  // If fresh cache exists, return immediately
  if (cached && (now - cached.timestamp < OPT_CACHE_TTL_SEC * 1000)) {
    const ageMinutes = Math.round((now - cached.timestamp) / 60000);
    console.log(`[${new Date().toISOString()}] 📊 Using fresh cached Polygon options for ${symbol} (age: ${ageMinutes} min)`);
    return cached.data;
  }

  // Try to fetch fresh data
  try {
    console.log(`[${new Date().toISOString()}] 🔍 Fetching fresh Polygon options for ${symbol}...`);
    
    // Step 1: Get current stock price
    const priceUrl = `${POLYGON_BASE_URL}/v2/aggs/ticker/${symbol}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
    const priceResp = await fetch(priceUrl, { timeout: 10000 });
    
    if (!priceResp.ok) {
      console.log(`[${new Date().toISOString()}] ⚠️  Polygon price fetch failed: ${priceResp.status} ${priceResp.statusText}`);
      return useStaleOrEmpty(cacheKey, cached, now, symbol);
    }
    
    const priceData = await priceResp.json();
    const spot = priceData.results?.[0]?.c || null;
    
    if (!spot) {
      console.log(`[${new Date().toISOString()}] ⚠️  No spot price from Polygon for ${symbol}: ${JSON.stringify(priceData)}`);
      return useStaleOrEmpty(cacheKey, cached, now, symbol);
    }

    console.log(`[${new Date().toISOString()}] 📊 Got spot price for ${symbol}: $${spot}`);

    // Step 2: Get options snapshot with Greeks, IV, and OI (requires paid tier)
    // Using the universal snapshot endpoint which includes all option chains with full data
    const snapshotUrl = `${POLYGON_BASE_URL}/v3/snapshot/options/${symbol}?apiKey=${POLYGON_API_KEY}`;
    console.log(`[${new Date().toISOString()}] 🔍 Fetching options snapshot for ${symbol}...`);
    
    const optionsResp = await fetch(snapshotUrl, { timeout: 15000 });
    
    if (!optionsResp.ok) {
      console.log(`[${new Date().toISOString()}] ⚠️  Polygon options fetch failed: ${optionsResp.status} ${optionsResp.statusText}`);
      return useStaleOrEmpty(cacheKey, cached, now, symbol);
    }
    
    const optionsData = await optionsResp.json();
    
    if (!optionsData.results || optionsData.results.length === 0) {
      console.log(`[${new Date().toISOString()}] ⚠️  No options data from Polygon for ${symbol}`);
      return useStaleOrEmpty(cacheKey, cached, now, symbol);
    }

    console.log(`[${new Date().toISOString()}] 📊 Got ${optionsData.results.length} option contracts from Polygon`);

    // Step 3: Process options data
    const rows = processPolygonOptions(optionsData.results, spot);
    
    // Step 4: Calculate metrics
    const metrics = calculateMetrics(rows, spot);
    
    const result = {
      spot: Math.round(spot * 100) / 100,
      rows,
      fetchedAt: new Date().toISOString(),
      atmIV: metrics.atmIV,
      putCallVolumeRatio: metrics.putCallVolumeRatio,
      impliedMove: metrics.impliedMove
    };

    // Cache the result
    optionsCache.set(cacheKey, {
      data: result,
      timestamp: now
    });

    console.log(`[${new Date().toISOString()}] ✅ Fetched fresh Polygon options for ${symbol}: ${rows.length} rows`);
    return result;

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Polygon fetch error for ${symbol}: ${error.message}`);
    return useStaleOrEmpty(cacheKey, cached, now, symbol);
  }
}

/**
 * Use stale cache or return empty
 */
function useStaleOrEmpty(cacheKey, cached, now, symbol) {
  // If stale cache exists (< OPT_STALE_TTL_SEC), return it
  if (cached && (now - cached.timestamp < OPT_STALE_TTL_SEC * 1000)) {
    const ageMinutes = Math.round((now - cached.timestamp) / 60000);
    console.log(`[${new Date().toISOString()}] 🔄 Using stale cached Polygon options for ${symbol} (age: ${ageMinutes} min)`);
    return {
      ...cached.data,
      isStale: true,
      cacheAge: now - cached.timestamp
    };
  }

  // No cache available
  console.log(`[${new Date().toISOString()}] ❌ No Polygon options data available for ${symbol} (no cache)`);
  return { 
    spot: null, 
    rows: [], 
    fetchedAt: new Date().toISOString(),
    atmIV: null,
    putCallVolumeRatio: null,
    impliedMove: null
  };
}

/**
 * Process Polygon options data into our standard format
 */
function processPolygonOptions(results, spot) {
  const rows = [];
  const now = Date.now();
  const maxDays = 30;

  for (const opt of results) {
    try {
      const details = opt.details;
      if (!details || !details.expiration_date) continue;

      const expiryDate = new Date(details.expiration_date);
      const ttmDays = (expiryDate - now) / (1000 * 60 * 60 * 24);

      // Only include options within 30 days
      if (ttmDays <= 0 || ttmDays > maxDays) continue;

      const greeks = opt.greeks || {};
      const lastQuote = opt.last_quote || {};

      // Filter: need implied volatility and basic data
      // Note: implied_volatility is a top-level field in Polygon API, not in greeks
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
        bid: lastQuote.bid || 0,
        ask: lastQuote.ask || 0,
        lastPrice: opt.day?.close || 0
      });
    } catch (err) {
      // Skip malformed options
      continue;
    }
  }

  return rows;
}

/**
 * Calculate ATM IV, Put/Call Ratio, and Implied Move
 */
function calculateMetrics(rows, spot) {
  if (!rows || rows.length === 0 || !spot) {
    return { atmIV: null, putCallVolumeRatio: null, impliedMove: null };
  }

  // Find nearest expiry
  const expiries = [...new Set(rows.map(r => r.expiryUTC))].sort();
  if (expiries.length === 0) return { atmIV: null, putCallVolumeRatio: null, impliedMove: null };

  const nearestExpiry = expiries[0];
  const expiryRows = rows.filter(r => r.expiryUTC === nearestExpiry);

  // 1. ATM IV
  let atmIV = null;
  const strikes = [...new Set(expiryRows.map(r => r.strike))].sort((a, b) => a - b);
  const atmStrike = strikes.reduce((prev, curr) => 
    Math.abs(curr - spot) < Math.abs(prev - spot) ? curr : prev
  );

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

  // 3. Implied Move (ATM straddle)
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

  return { atmIV, putCallVolumeRatio, impliedMove };
}

