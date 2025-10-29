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
    // Request up to 250 contracts per page to ensure we get ATM contracts
    const snapshotUrl = `${POLYGON_BASE_URL}/v3/snapshot/options/${symbol}?limit=250&apiKey=${POLYGON_API_KEY}`;
    console.log(`[${new Date().toISOString()}] 🔍 Fetching options snapshot for ${symbol}...`);
    
    const optionsResp = await fetch(snapshotUrl, { timeout: 15000 });
    
    if (!optionsResp.ok) {
      console.log(`[${new Date().toISOString()}] ⚠️  Polygon options fetch failed: ${optionsResp.status} ${optionsResp.statusText}`);
      return useStaleOrEmpty(cacheKey, cached, now, symbol);
    }
    
    let optionsData = await optionsResp.json();
    let allContracts = optionsData.results || [];
    
    // Fetch additional pages if available (up to 2 more pages for ~750 total contracts)
    let pageCount = 1;
    while (optionsData.next_url && pageCount < 3) {
      console.log(`[${new Date().toISOString()}] 📊 Fetching page ${pageCount + 1}...`);
      const nextResp = await fetch(optionsData.next_url + `&apiKey=${POLYGON_API_KEY}`, { timeout: 15000 });
      if (nextResp.ok) {
        optionsData = await nextResp.json();
        allContracts = allContracts.concat(optionsData.results || []);
        pageCount++;
      } else {
        break;
      }
    }
    
    if (allContracts.length === 0) {
      console.log(`[${new Date().toISOString()}] ⚠️  No options data from Polygon for ${symbol}`);
      return useStaleOrEmpty(cacheKey, cached, now, symbol);
    }

    console.log(`[${new Date().toISOString()}] 📊 Got ${allContracts.length} option contracts from Polygon across ${pageCount} pages`);

    // Step 3: Process options data
    const rows = processPolygonOptions(allContracts, spot);
    
    // Extract data timestamp from options snapshot
    // For paid plans: Polygon.io provides 15-minute delayed data
    // Use the most recent last_updated from contracts, or estimate based on fetch time
    let dataTimestamp = null;
    let maxLastUpdated = 0;
    
    // Find the most recent last_updated timestamp across all contracts
    for (const contract of allContracts) {
      if (contract.day?.last_updated) {
        const timestampNs = contract.day.last_updated;
        if (timestampNs > maxLastUpdated) {
          maxLastUpdated = timestampNs;
        }
      }
    }
    
    if (maxLastUpdated > 0) {
      // Convert nanosecond timestamp to milliseconds
      const timestampMs = Math.floor(maxLastUpdated / 1000000);
      const lastUpdatedDate = new Date(timestampMs);
      
      // For paid plans: Polygon.io is 15-minute delayed during market hours
      // Strategy:
      // - During market hours: ALWAYS use fetch time - 15 min (15-min delayed)
      // - After market close: use last_updated (market close time)
      // 
      // Check if markets are currently open (9:30 AM - 4 PM ET)
      const currentET = new Date().toLocaleString('en-US', { 
        timeZone: 'America/New_York', 
        hour: 'numeric', 
        minute: 'numeric', 
        hour12: false 
      });
      const [etHour, etMinute] = currentET.split(':').map(Number);
      const isMarketHours = (etHour > 9 || (etHour === 9 && etMinute >= 30)) && etHour < 16;
      
      if (isMarketHours) {
        // Markets are open - use fetch time - 15 min (paid plan = 15-min delayed)
        dataTimestamp = new Date(now - 15 * 60 * 1000).toISOString();
      } else {
        // Markets are closed - use last_updated (market close time)
        dataTimestamp = lastUpdatedDate.toISOString();
      }
    } else {
      // No timestamp found, estimate based on fetch time minus 15 min delay (paid plan = 15-min delayed)
      dataTimestamp = new Date(now - 15 * 60 * 1000).toISOString();
    }
    
    console.log(`[${new Date().toISOString()}] 📅 Options data timestamp: ${dataTimestamp} (15-min delayed)`);
    
    // Step 4: Calculate metrics
    const metrics = calculateMetrics(rows, spot);
    
    const result = {
      spot: Math.round(spot * 100) / 100,
      rows,
      fetchedAt: new Date().toISOString(),
      dataTimestamp: dataTimestamp, // When the options data was last updated (every 15 min during market hours)
      atmIV: metrics.atmIV,
      putCallVolumeRatio: metrics.putCallVolumeRatio,
      impliedMove: metrics.impliedMove,
      maxPain: metrics.maxPain,
      putCallOIRatio: metrics.putCallOIRatio,
      totalDelta: metrics.totalDelta,
      gammaWalls: metrics.gammaWalls,
      ivTermStructure: metrics.ivTermStructure,
      zeroGammaLevel: metrics.zeroGammaLevel,
      multipleExpectedMoves: metrics.multipleExpectedMoves,
      totalVega: metrics.totalVega,
      vanna: metrics.vanna
    };

    // Cache the result
    optionsCache.set(cacheKey, {
      data: result,
      timestamp: now
    });

    console.log(`[${new Date().toISOString()}] ✅ Fetched fresh Polygon options for ${symbol}: ${rows.length} rows, NEW METRICS: multipleExpectedMoves=${!!metrics.multipleExpectedMoves}, totalVega=${!!metrics.totalVega}, vanna=${!!metrics.vanna}`);
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
    dataTimestamp: null,
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
 * Black-Scholes helpers for Greeks calculations
 */
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
  return (spot * pdf * Math.sqrt(ttmYears)) / 100; // divide by 100 to get per 1% move
}

function calculateVanna(spot, strike, ttmYears, iv) {
  if (ttmYears <= 0 || iv <= 0) return 0;
  const d1 = (Math.log(spot / strike) + (0.5 * iv * iv) * ttmYears) / (iv * Math.sqrt(ttmYears));
  const d2 = d1 - iv * Math.sqrt(ttmYears);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return -(pdf * d2) / iv; // vanna per 1% IV move
}

/**
 * Calculate all options metrics including new advanced metrics
 */
function calculateMetrics(rows, spot) {
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

  // Find nearest expiry
  const expiries = [...new Set(rows.map(r => r.expiryUTC))].sort();
  if (expiries.length === 0) {
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

  // 4. Call/Put OI Ratio (positioning vs flow)
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

  // 5. Max Pain (strike where most $ expires worthless)
  let maxPain = null;
  const strikeValues = {};
  
  for (const row of expiryRows) {
    if (!strikeValues[row.strike]) {
      strikeValues[row.strike] = 0;
    }
    
    // Calculate value of options if spot = this strike
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
      totalValue: Math.round(strikeValues[maxPainStrike] / 1e9 * 10) / 10 // in billions
    };
  }

  // 6. Total Delta (net directional bias)
  let totalDelta = null;
  let netDelta = 0;
  const now = Date.now();
  
  for (const row of rows.filter(r => r.oi > 0)) {
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - now) / (1000 * 60 * 60 * 24 * 365.25);
    
    if (ttmYears > 0) {
      const delta = calculateDelta(spot, row.strike, ttmYears, row.iv, row.type === 'call');
      netDelta += delta * row.oi * 100 * spot; // dollar delta
    }
  }
  
  totalDelta = {
    value: Math.round(netDelta / 1e6), // in millions
    formatted: `${netDelta > 0 ? '+' : ''}$${Math.round(Math.abs(netDelta) / 1e6)}M`,
    bias: netDelta > 0 ? 'bullish' : netDelta < 0 ? 'bearish' : 'neutral'
  };

  // 7. Gamma Walls (strikes with concentrated gamma)
  let gammaWalls = null;
  const gammaByStrike = {};
  
  for (const row of expiryRows) {
    if (!gammaByStrike[row.strike]) {
      gammaByStrike[row.strike] = 0;
    }
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - now) / (1000 * 60 * 60 * 24 * 365.25);
    
    if (ttmYears > 0 && row.iv > 0) {
      const d1 = (Math.log(spot / row.strike) + (0.5 * row.iv * row.iv) * ttmYears) / (row.iv * Math.sqrt(ttmYears));
      const gamma = Math.exp(-0.5 * d1 * d1) / (Math.sqrt(2 * Math.PI) * spot * row.iv * Math.sqrt(ttmYears));
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
      gamma: Math.round(g.gamma / 1e9 * 10) / 10, // billions
      formatted: `$${g.strike} (${g.gamma > 0 ? '+' : ''}$${Math.round(Math.abs(g.gamma) / 1e9 * 10) / 10}B)`
    }));
  }

  // 8. IV Term Structure (near vs far dated IV)
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

  // 9. Zero Gamma Level (where net gamma = 0)
  let zeroGammaLevel = null;
  const testStrikes = strikes.filter(s => s > spot * 0.9 && s < spot * 1.1);
  
  if (testStrikes.length >= 2) {
    let closestStrike = testStrikes[0];
    let minGammaDiff = Infinity;
    
    for (const testStrike of testStrikes) {
      let netGamma = 0;
      
      for (const row of expiryRows) {
        const expiryDate = new Date(row.expiryUTC);
        const ttmYears = (expiryDate - now) / (1000 * 60 * 60 * 24 * 365.25);
        
        if (ttmYears > 0 && row.iv > 0) {
          const d1 = (Math.log(testStrike / row.strike) + (0.5 * row.iv * row.iv) * ttmYears) / (row.iv * Math.sqrt(ttmYears));
          const gamma = Math.exp(-0.5 * d1 * d1) / (Math.sqrt(2 * Math.PI) * testStrike * row.iv * Math.sqrt(ttmYears));
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

  // 10. Multiple Expected Moves (straddles across different expiries)
  let multipleExpectedMoves = null;
  if (expiries.length >= 1) {
    const moves = [];
    
    for (let i = 0; i < Math.min(3, expiries.length); i++) {
      const expiry = expiries[i];
      const expiryDate = new Date(expiry);
      const ttmYears = (expiryDate - now) / (1000 * 60 * 60 * 24 * 365.25);
      const daysToExpiry = Math.round((expiryDate - now) / (1000 * 60 * 60 * 24));
      
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

  // 11. Total Vega (sensitivity to IV changes across portfolio)
  let totalVega = null;
  let netVega = 0;
  
  for (const row of rows.filter(r => r.oi > 0)) {
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - now) / (1000 * 60 * 60 * 24 * 365.25);
    
    if (ttmYears > 0 && row.iv > 0) {
      const vega = calculateVega(spot, row.strike, ttmYears, row.iv);
      netVega += vega * row.oi * 100; // notional vega
    }
  }
  
  totalVega = {
    value: Math.round(netVega / 1e6), // in millions per 1% IV move
    formatted: `${netVega > 0 ? '+' : ''}$${Math.round(Math.abs(netVega) / 1e6)}M per 1% IV`,
    bias: netVega > 0 ? 'long volatility' : netVega < 0 ? 'short volatility' : 'neutral'
  };

  // 12. Vanna (sensitivity to spot moves changing delta sensitivity to IV)
  let vanna = null;
  let netVanna = 0;
  
  for (const row of rows.filter(r => r.oi > 0)) {
    const expiryDate = new Date(row.expiryUTC);
    const ttmYears = (expiryDate - now) / (1000 * 60 * 60 * 24 * 365.25);
    
    if (ttmYears > 0 && row.iv > 0) {
      const vannaValue = calculateVanna(spot, row.strike, ttmYears, row.iv);
      netVanna += vannaValue * row.oi * 100 * spot; // dollar vanna
    }
  }
  
  vanna = {
    value: Math.round(netVanna / 1e6), // in millions
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

