/** Massive (formerly Polygon) options adapter. Legacy metric fields are retained. */
import fetch from 'node-fetch';
import {collectSnapshot,normalizeSnapshot} from './polygonSnapshot.js';

const METRICS=['atmIV','putCallVolumeRatio','impliedMove','maxPain','putCallOIRatio','totalDelta','gammaWalls','ivTermStructure','zeroGammaLevel','multipleExpectedMoves','totalVega','vanna'];
const nullMetrics=()=>Object.fromEntries(METRICS.map(key=>[key,null]));
const seconds=(value,fallback)=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):fallback;
/** Isolated factory permits deterministic tests without real credentials or network calls. */
export function createPolygonProvider({fetchImpl=fetch,now=Date.now,getKey=()=>process.env.POLYGON_API_KEY,freshSeconds=seconds(process.env.OPT_CACHE_TTL_SEC,14400),staleSeconds=seconds(process.env.OPT_STALE_TTL_SEC,86400),maxPages=40}={}) {
  const cache=new Map(),pending=new Map();
  async function retrieve(symbol) {
    if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol))throw Error('Invalid underlying symbol.');
    const cached=cache.get(symbol),started=now(),key=getKey();
    const unavailable=reason=>({spot:null,rows:[],fetchedAt:new Date(now()).toISOString(),dataTimestamp:null,...nullMetrics(),coverage:{complete:false,reason},quality:{usableForAggregates:false,flags:[reason]}});
    // Do not return a previous credential's cached observations after the configured key is removed/changed.
    if(!key)return unavailable('credential_unavailable');
    const validCache=cached?.key===key?cached:null;
    if(validCache&&started-validCache.timestamp<freshSeconds*1000)return structuredClone({...validCache.data,cacheAge:started-validCache.timestamp});
    const raw=await collectSnapshot({symbol,apiKey:key,fetchImpl,now,maxPages});
    const data=normalizeSnapshot(raw.contracts,symbol,raw.receivedAt);
    const flags=[...data.flags,'snapshot_not_historical_point_in_time','chain_observations_are_not_atomic','legacy_analytics_not_validated_for_execution'];
    if(!raw.coverage.complete)flags.push('incomplete_chain');
    // Incomplete collection or invalid contracts must not feed full-scope downstream aggregates.
    const eligible=raw.coverage.complete&&data.counts.invalidContract===0&&data.counts.nonstandardContract===0;
    const rows=eligible?data.rows:[];
    let metrics=rows.length&&data.spot!==null?calculateMetrics(rows,data.spot,raw.receivedAt):nullMetrics();
    if(rows.some(r=>r.oi===null))for(const name of ['maxPain','putCallOIRatio','totalDelta','gammaWalls','zeroGammaLevel','totalVega','vanna','ivTermStructure','multipleExpectedMoves'])metrics[name]=null;
    if(rows.some(r=>r.iv===null))for(const name of ['totalDelta','gammaWalls','zeroGammaLevel','totalVega','vanna','ivTermStructure','multipleExpectedMoves'])metrics[name]=null;
    if(rows.some(r=>r.volume===null))metrics.putCallVolumeRatio=null;
    const result={spot:data.spot,spotObservedAt:data.spotObservedAt,spotTimeframe:data.spotTimeframe,rows,
      fetchedAt:new Date(raw.receivedAt).toISOString(),collectionStartedAt:new Date(raw.startedAt).toISOString(),dataTimestamp:data.dataTimestamp,
      oldestObservationAt:data.oldestObservationAt,dataTimestampMeaning:'latest_known_contract_observation_not_whole_chain_asof',
      coverage:{...raw.coverage,eligibleContracts:data.rows.length,excluded:data.counts},
      quality:{usableForAggregates:eligible&&rows.length>0&&data.spot!==null&&rows.every(r=>r.iv!==null&&r.oi!==null),verifiedPointInTime:false,flags:[...new Set(flags)].sort(),expiryConvention:'provider_date_at_00_00_UTC_not_settlement_time'},
      ...metrics};
    if(!eligible||!rows.length){
      if(validCache&&now()-validCache.timestamp<staleSeconds*1000)return structuredClone({...validCache.data,isStale:true,cacheAge:now()-validCache.timestamp,refreshFailure:raw.coverage.reason||'no_eligible_contracts'});
      return result;
    }
    cache.set(symbol,{data:structuredClone(result),timestamp:raw.receivedAt,key});
    return result;
  }
  return async symbol=>{
    // Requests for one symbol share a collection; no repeated page fan-out under load.
    if(!pending.has(symbol))pending.set(symbol,retrieve(symbol).finally(()=>pending.delete(symbol)));
    return structuredClone(await pending.get(symbol));
  };
}
export const fetchPolygonOptions=createPolygonProvider();

function quoteMid(row) {return row.quoteObservedAt&&row.bid!==null&&row.ask!==null&&row.bid>=0&&row.ask>=row.bid?(row.bid+row.ask)/2:null;}

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
function calculateMetrics(rows, spot, asOf) {
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

  const atmCall = expiryRows.find(r => r.strike === atmStrike && r.type === 'call' && r.iv !== null);
  const atmPut = expiryRows.find(r => r.strike === atmStrike && r.type === 'put' && r.iv !== null);

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
    const callMid = quoteMid(atmCall);
    const putMid = quoteMid(atmPut);

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
  const now = asOf;
  
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
