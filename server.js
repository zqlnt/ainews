import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { fetchOptions, getOptionsProvider } from './lib/optionsProvider.js';
import { initCacheWarmer } from './lib/cacheWarmer.js';
import { validateAnalysisV2, parseFromLegacyText, buildLegacyText } from './lib/analysisValidator.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Parse JSON request bodies

// API Keys from environment variables
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const ALPACA_BASE_URL = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

// Utility function to log with timestamp
const log = (message) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
};

// Utility function to get date range (last 24 hours)
const getDateRange = () => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const formatDate = (date) => {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  };
  
  return {
    from: formatDate(yesterday),
    to: formatDate(today)
  };
};

// Extract ticker symbol from user query
const extractSymbol = (query) => {
  // Common stock ticker patterns (2-5 uppercase letters)
  const symbolPattern = /\b([A-Z]{2,5})\b/g;
  const matches = query.match(symbolPattern);
  
  if (!matches) return null;
  
  // Filter out common words that aren't tickers
  const excludeWords = ['CEO', 'CFO', 'IPO', 'ETF', 'AI', 'IT', 'US', 'UK', 'USD', 'API', 'FAQ'];
  const validSymbols = matches.filter(word => !excludeWords.includes(word));
  
  // Return first valid symbol found
  return validSymbols.length > 0 ? validSymbols[0] : null;
};

// Detect if query is asking for investment advice
const isAdviceSeekingQuery = (query) => {
  const lowerQuery = query.toLowerCase();
  
  const advicePatterns = [
    /what should i (buy|sell|invest|do)/i,
    /should i (buy|sell|invest)/i,
    /i have \$?\d+.*what/i,
    /recommend.*stock/i,
    /which stock.*buy/i,
    /tell me what to/i,
    /give me.*advice/i,
    /best stock to/i
  ];
  
  return advicePatterns.some(pattern => pattern.test(lowerQuery));
};

// Fetch live price data from Alpaca
const fetchAlpacaPrice = async (symbol) => {
  try {
    if (!ALPACA_API_KEY || !ALPACA_SECRET_KEY) {
      log(`⚠️  Alpaca keys not configured, skipping price fetch`);
      return null;
    }

    // Use data endpoint for market data (not trading endpoint)
    const url = `https://data.alpaca.markets/v2/stocks/${symbol}/quotes/latest`;
    
    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': ALPACA_API_KEY,
        'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY
      }
    });

    if (!response.ok) {
      log(`⚠️  Alpaca API error for ${symbol}: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.quote) {
      const currentPrice = data.quote.ap || data.quote.bp; // ask price or bid price
      
      // Get previous close from bars endpoint
      const barsUrl = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&limit=2`;
      const barsResponse = await fetch(barsUrl, {
        headers: {
          'APCA-API-KEY-ID': ALPACA_API_KEY,
          'APCA-API-SECRET-KEY': ALPACA_SECRET_KEY
        }
      });
      
      let prevClose = currentPrice;
      if (barsResponse.ok) {
        const barsData = await barsResponse.json();
        if (barsData.bars && barsData.bars.length > 0) {
          prevClose = barsData.bars[0].c; // Previous day's close
        }
      }
      
      const change = currentPrice - prevClose;
      const changePercent = ((change / prevClose) * 100).toFixed(2);
      
      log(`💰 Alpaca price for ${symbol}: $${currentPrice} (${changePercent > 0 ? '+' : ''}${changePercent}%)`);
      
      return {
        symbol,
        currentPrice,
        prevClose,
        change,
        changePercent
      };
    }
    
    return null;
  } catch (error) {
    log(`⚠️  Alpaca fetch error for ${symbol}: ${error.message}`);
    return null; // Fail gracefully
  }
};

// Task 3: Options cache (1-5 min TTL per symbol)
const optionsCache = new Map();
const OPTIONS_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

// Task 3: Fetch options chain from Yahoo Finance
const fetchOptionsChain = async (symbol) => {
  try {
    // Check cache first
    const cached = optionsCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < OPTIONS_CACHE_TTL) {
      log(`📊 Using cached options for ${symbol}`);
      return cached.data;
    }

    // Step 1: Fetch available expiration dates with proper headers
    const baseUrl = `https://query2.finance.yahoo.com/v7/finance/options/${symbol}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    const response = await fetch(baseUrl, { headers });

    if (!response.ok) {
      log(`⚠️  Yahoo options API error for ${symbol}: HTTP ${response.status}`);
      return { optionsUnavailable: true };
    }

    const data = await response.json();
    
    if (!data.optionChain || !data.optionChain.result || data.optionChain.result.length === 0) {
      log(`⚠️  No options data for ${symbol}`);
      return { optionsUnavailable: true };
    }

    const result = data.optionChain.result[0];
    const expirationDates = result.expirationDates || [];
    const quote = result.quote;

    if (expirationDates.length === 0) {
      log(`⚠️  No expiration dates for ${symbol}`);
      return { optionsUnavailable: true };
    }

    // Step 2: Filter expirations within 30 days
    const now = Date.now() / 1000;
    const thirtyDaysFromNow = now + (30 * 24 * 60 * 60);
    const nearExpirations = expirationDates.filter(exp => exp <= thirtyDaysFromNow);

    if (nearExpirations.length === 0) {
      log(`⚠️  No options expiring within 30 days for ${symbol}`);
      return { optionsUnavailable: true };
    }

    // Step 3: Fetch options for the nearest 2-3 expirations
    const expirationsToFetch = nearExpirations.slice(0, 3);
    let allCalls = [];
    let allPuts = [];

    for (const expDate of expirationsToFetch) {
      const expUrl = `${baseUrl}?date=${expDate}`;
      const expResponse = await fetch(expUrl, { headers });
      
      if (expResponse.ok) {
        const expData = await expResponse.json();
        const expOptions = expData.optionChain?.result?.[0]?.options?.[0];
        
        if (expOptions) {
          // Filter out bad rows: null/0 IV or OI
          const validCalls = (expOptions.calls || []).filter(opt => 
            opt.impliedVolatility > 0 && opt.openInterest > 0 && opt.strike > 0
          );
          const validPuts = (expOptions.puts || []).filter(opt => 
            opt.impliedVolatility > 0 && opt.openInterest > 0 && opt.strike > 0
          );
          
          allCalls = allCalls.concat(validCalls);
          allPuts = allPuts.concat(validPuts);
        }
      }
      
      // Small delay to avoid throttling
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Step 4: Validate we have enough data
    if (allCalls.length < 5 || allPuts.length < 5) {
      log(`⚠️  Insufficient valid options data for ${symbol} (calls: ${allCalls.length}, puts: ${allPuts.length})`);
      return { optionsUnavailable: true };
    }

    const parsedData = {
      optionsUnavailable: false,
      calls: allCalls,
      puts: allPuts,
      expirationDates: expirationsToFetch,
      quote: quote
    };

    // Cache the result
    optionsCache.set(symbol, {
      data: parsedData,
      timestamp: Date.now()
    });

    log(`✅ Fetched options for ${symbol}: ${allCalls.length} valid calls, ${allPuts.length} valid puts across ${expirationsToFetch.length} expirations`);
    return parsedData;

  } catch (error) {
    log(`⚠️  Options fetch error for ${symbol}: ${error.message}`);
    return { optionsUnavailable: true };
  }
};

// Task 4: Black-Scholes helper functions
const normalPDF = (x) => {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
};

const calculateGamma = (S, K, T, sigma) => {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normalPDF(d1) / (S * sigma * Math.sqrt(T));
};

// Task 4: Calculate Dealer Gamma (0-30d)
const calculateDealerGamma = (optionsData, spotPrice) => {
  if (optionsData.optionsUnavailable || !spotPrice) {
    return { unavailable: true };
  }

  const now = Date.now() / 1000; // Unix timestamp in seconds
  const thirtyDaysFromNow = now + (30 * 24 * 60 * 60);

  let totalGamma = 0;
  const strikeContributions = [];

  // Process calls
  for (const option of optionsData.calls) {
    const expiration = option.expiration;
    
    if (!expiration || expiration > thirtyDaysFromNow) continue;

    const T = (expiration - now) / (365.25 * 24 * 60 * 60);
    const K = option.strike;
    const IV = option.impliedVolatility;
    const OI = option.openInterest;

    if (IV <= 0 || OI <= 0 || T <= 0) continue;

    const gamma = calculateGamma(spotPrice, K, T, IV);
    const dollarGamma = gamma * spotPrice * spotPrice * 100 * OI;
    
    totalGamma += dollarGamma;
    strikeContributions.push({ strike: K, gamma: dollarGamma, type: 'call' });
  }

  // Process puts
  for (const option of optionsData.puts) {
    const expiration = option.expiration;
    
    if (!expiration || expiration > thirtyDaysFromNow) continue;

    const T = (expiration - now) / (365.25 * 24 * 60 * 60);
    const K = option.strike;
    const IV = option.impliedVolatility;
    const OI = option.openInterest;

    if (IV <= 0 || OI <= 0 || T <= 0) continue;

    const gamma = calculateGamma(spotPrice, K, T, IV);
    const dollarGamma = gamma * spotPrice * spotPrice * 100 * OI;
    
    totalGamma += dollarGamma;
    strikeContributions.push({ strike: K, gamma: dollarGamma, type: 'put' });
  }

  if (strikeContributions.length === 0) {
    return { unavailable: true };
  }

  // Dealer convention: negative of the sum (dealers are short gamma)
  const dealerGamma = -totalGamma;
  const gammaInBillions = dealerGamma / 1e9;
  const sign = dealerGamma < 0 ? 'short' : 'long';

  const topStrikes = strikeContributions
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))
    .slice(0, 3);

  return {
    unavailable: false,
    value: gammaInBillions,
    sign,
    formatted: `${gammaInBillions > 0 ? '+' : ''}$${Math.abs(gammaInBillions).toFixed(1)}B (${sign})`,
    topStrikes
  };
};

// Task 4: Calculate Skew (±10% OTM)
const calculateSkew = (optionsData, spotPrice) => {
  if (optionsData.optionsUnavailable || !spotPrice) {
    return { unavailable: true };
  }

  const putStrike = spotPrice * 0.9;  // 10% OTM put
  const callStrike = spotPrice * 1.1; // 10% OTM call

  // Find closest strikes and interpolate IV if needed
  const findIV = (options, targetStrike) => {
    const sorted = options
      .filter(o => o.impliedVolatility > 0)
      .sort((a, b) => a.strike - b.strike);

    if (sorted.length === 0) return null;

    // Find bracketing strikes
    let lower = null, upper = null;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].strike <= targetStrike) lower = sorted[i];
      if (sorted[i].strike >= targetStrike && !upper) upper = sorted[i];
    }

    if (!lower && !upper) return null;
    if (!lower) return upper.impliedVolatility;
    if (!upper) return lower.impliedVolatility;
    if (lower.strike === upper.strike) return lower.impliedVolatility;

    // Linear interpolation
    const weight = (targetStrike - lower.strike) / (upper.strike - lower.strike);
    return lower.impliedVolatility + weight * (upper.impliedVolatility - lower.impliedVolatility);
  };

  const putIV = findIV(optionsData.puts, putStrike);
  const callIV = findIV(optionsData.calls, callStrike);

  if (!putIV || !callIV) {
    return { unavailable: true };
  }

  // Skew = Put IV - Call IV (in percentage points)
  const skew = (putIV - callIV) * 100;

  return {
    unavailable: false,
    value: skew,
    formatted: `${skew.toFixed(1)} pp`,
    putIV: (putIV * 100).toFixed(1),
    callIV: (callIV * 100).toFixed(1)
  };
};

// Task 5: Clean and format news into evidence bullets
const formatNewsEvidence = (newsString) => {
  if (!newsString || newsString.trim() === '') {
    return [];
  }

  // Split by periods, newlines, or semicolons
  const sentences = newsString
    .split(/[.\n;]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10) // Filter out very short fragments
    .map(s => {
      // Clean up extra whitespace and punctuation
      s = s.replace(/\s+/g, ' ').trim();
      // Ensure it ends with a period
      if (!s.match(/[.!?]$/)) s += '.';
      return s;
    })
    .filter(s => s.length > 15); // Final filter for meaningful sentences

  return sentences.slice(0, 5); // Limit to top 5 evidence points
};

// Calculate Dealer Gamma from yfinance rows
const calculateDealerGammaFromRows = (rows, spotPrice) => {
  if (!rows || rows.length === 0 || !spotPrice) {
    return { unavailable: true };
  }

  let totalGamma = 0;
  const strikeContributions = [];

  for (const row of rows) {
    const T = row.ttmDays / 365.25; // Convert days to years
    const K = row.strike;
    const IV = row.iv;
    const OI = row.oi;

    if (IV <= 0 || OI <= 0 || T <= 0) continue;

    // Calculate gamma using Black-Scholes
    const gamma = calculateGamma(spotPrice, K, T, IV);
    
    // Dollar gamma: Γ × S² × 100 × OI
    const dollarGamma = gamma * spotPrice * spotPrice * 100 * OI;
    
    totalGamma += dollarGamma;
    strikeContributions.push({ strike: K, gamma: dollarGamma, type: row.type });
  }

  if (strikeContributions.length === 0) {
    return { unavailable: true };
  }

  // Dealer convention: negative of the sum (dealers are short gamma)
  const dealerGamma = -totalGamma;
  const gammaInBillions = dealerGamma / 1e9;
  const sign = dealerGamma < 0 ? 'short' : 'long';

  const topStrikes = strikeContributions
    .sort((a, b) => Math.abs(b.gamma) - Math.abs(a.gamma))
    .slice(0, 3);

  return {
    unavailable: false,
    value: gammaInBillions,
    sign,
    formatted: `${gammaInBillions > 0 ? '+' : ''}$${Math.abs(gammaInBillions).toFixed(1)}B (${sign})`,
    topStrikes
  };
};

// Calculate Skew from yfinance rows
const calculateSkewFromRows = (rows, spotPrice) => {
  if (!rows || rows.length === 0 || !spotPrice) {
    return { unavailable: true };
  }

  const putStrike = spotPrice * 0.9;  // 10% OTM put
  const callStrike = spotPrice * 1.1; // 10% OTM call

  // Find IV at target strikes (linear interpolation if needed)
  const findIV = (options, targetStrike) => {
    const sorted = options
      .filter(o => o.iv > 0)
      .sort((a, b) => a.strike - b.strike);

    if (sorted.length === 0) return null;

    // Find bracketing strikes
    let lower = null, upper = null;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].strike <= targetStrike) lower = sorted[i];
      if (sorted[i].strike >= targetStrike && !upper) upper = sorted[i];
    }

    if (!lower && !upper) return null;
    if (!lower) return upper.iv;
    if (!upper) return lower.iv;
    if (lower.strike === upper.strike) return lower.iv;

    // Linear interpolation
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

  // Skew = Put IV - Call IV (in percentage points)
  const skew = (putIV - callIV) * 100;

  return {
    unavailable: false,
    value: skew,
    formatted: `${skew.toFixed(1)} pp`,
    putIV: (putIV * 100).toFixed(1),
    callIV: (callIV * 100).toFixed(1)
  };
};

// Test Claude API connection
const testClaudeAPI = async () => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: 'Hello, respond with "API Working"'
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Unknown error');
    }

    const data = await response.json();
    return { 
      success: true, 
      message: 'Connected successfully',
      response: data.content[0].text 
    };
  } catch (error) {
    return { 
      success: false, 
      message: error.message 
    };
  }
};

// Test Finnhub API connection
const testFinnhubAPI = async () => {
  try {
    const { from, to } = getDateRange();
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=AAPL&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }

    return { 
      success: true, 
      message: 'Connected successfully',
      count: data.length,
      sampleHeadline: data[0]?.headline || 'No headlines available'
    };
  } catch (error) {
    return { 
      success: false, 
      message: error.message 
    };
  }
};

/**
 * Call Claude API with structured output (tool calling)
 * Returns { success, data: { text, structured }, usage }
 * 
 * @param {string} prompt - The prompt to send to Claude
 * @param {boolean} requestStructured - Whether to request structured JSON output
 * @returns {Promise<Object>}
 */
const callClaudeAPI = async (prompt, requestStructured = true) => {
  const tools = requestStructured ? [{
    name: "provide_analysis",
    description: "Provide structured stock analysis with intro, sentiment perspectives, and confidence scores",
    input_schema: {
      type: "object",
      properties: {
        intro: {
          type: "string",
          description: "2-4 sentence overview of the situation, including quant metrics if available"
        },
        bullish: {
          type: "string",
          description: "1-2 sentences explaining the bullish/positive perspective based on evidence"
        },
        bearish: {
          type: "string",
          description: "1-2 sentences explaining the bearish/negative perspective based on evidence"
        },
        neutral: {
          type: "string",
          description: "1-2 sentences explaining the neutral/wait-and-see perspective based on evidence"
        },
        confidence: {
          type: "object",
          properties: {
            bullish: { type: "number", description: "Confidence in bullish view (0.0-1.0)" },
            bearish: { type: "number", description: "Confidence in bearish view (0.0-1.0)" },
            neutral: { type: "number", description: "Confidence in neutral view (0.0-1.0)" }
          },
          required: ["bullish", "bearish", "neutral"]
        }
      },
      required: ["intro", "bullish", "bearish", "neutral", "confidence"]
    }
  }] : undefined;

  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: prompt
    }]
  };

  if (tools) {
    body.tools = tools;
    body.tool_choice = { type: "tool", name: "provide_analysis" };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Claude API error');
  }

  const data = await response.json();

  // Extract text and structured data
  let textContent = '';
  let structuredData = null;

  for (const content of data.content) {
    if (content.type === 'text') {
      textContent += content.text;
    } else if (content.type === 'tool_use' && content.name === 'provide_analysis') {
      structuredData = content.input;
    }
  }

  return {
    success: true,
    data: {
      text: textContent || null,
      structured: structuredData
    },
    usage: data.usage
  };
};

// ==================== ENDPOINTS ====================

// Health check endpoint
app.get('/', (req, res) => {
  log('Health check request received');
  res.json({ 
    status: 'running',
    message: 'AI News Stock Analysis API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /',
      analyze: 'POST /analyze',
      news: 'GET /news/:symbol',
      testClaude: 'GET /test/claude',
      testFinnhub: 'GET /test/finnhub',
      testAll: 'GET /test/all'
    }
  });
});

// POST /analyze - Claude AI stock analysis (with structured v2 output)
app.post('/analyze', async (req, res) => {
  try {
    const { query, news } = req.body;

    // Validate input - query is required, news can be empty
    if (!query) {
      log('❌ /analyze - Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Please provide "query" in request body'
      });
    }
    
    // Allow empty news string (for conceptual questions)
    const newsText = news || '';

    log(`📊 /analyze - Processing query: "${query}"`);

    // Task 1: Check if query is asking for investment advice
    if (isAdviceSeekingQuery(query)) {
      log('🚫 /analyze - Advice-seeking query detected, returning non-advice message');
      const adviceText = "I can't provide investment advice. I can show what's moving, explain drivers, or summarize risks. Try: 'Summarize my watchlist' or 'Why did NVDA move today?'";
      
      return res.json({
        success: true,
        schema_version: "2.0",
        analysis: adviceText,
        analysis_v2: validateAnalysisV2({
          intro: adviceText,
          bullish: null,
          bearish: null,
          neutral: null
        }, {
          ticker: null,
          sources: [],
          parseStatus: 'ok'
        }),
        usage: {
          input_tokens: 0,
          output_tokens: 0
        }
      });
    }

    // Task 1: Extract ticker symbol from query
    const symbol = extractSymbol(query);
    log(`🔍 /analyze - Extracted symbol: ${symbol || 'none'}`);

    // Task 5: Format news into clean evidence bullets
    const evidence = formatNewsEvidence(newsText);
    log(`📋 /analyze - Formatted ${evidence.length} evidence points`);

    // Track data source timestamps (for both legacy footer and v2 sources)
    const dataSources = []; // Legacy format: { source, type, timestamp }
    const sourcesV2 = []; // V2 format: { type, provider, timestamp, status, freshness_seconds }

    // Task 2: Fetch live price data from Alpaca if symbol found
    let priceData = null;
    let spotPrice = null;
    if (symbol) {
      const priceTimestamp = new Date();
      priceData = await fetchAlpacaPrice(symbol);
      spotPrice = priceData?.currentPrice;
      if (priceData) {
        dataSources.push({
          source: 'Alpaca',
          type: 'price',
          timestamp: priceTimestamp
        });
        sourcesV2.push({
          type: 'price',
          provider: 'Alpaca',
          timestamp: priceTimestamp.toISOString(),
          status: 'ok',
          freshness_seconds: 0 // Will be computed during validation
        });
      }
    }

    // Task 3: Fetch options via yfinance bridge if symbol found
    let optionsData = { spot: null, rows: [], fetchedAt: null };
    if (symbol) {
      optionsData = await fetchOptions(symbol);
      
      const hasOptionsData = optionsData.rows && optionsData.rows.length > 0;
      const isStale = optionsData.isStale || false;
      
      if (hasOptionsData) {
        const optionsTimestamp = new Date(optionsData.fetchedAt);
        dataSources.push({
          source: 'Options (yfinance local)',
          type: 'options',
          timestamp: optionsTimestamp
        });
        sourcesV2.push({
          type: 'options',
          provider: 'yfinance',
          timestamp: optionsTimestamp.toISOString(),
          status: isStale ? 'stale' : 'ok',
          freshness_seconds: 0 // Will be computed during validation
        });
      } else {
        // Options attempted but unavailable
        sourcesV2.push({
          type: 'options',
          provider: 'yfinance',
          timestamp: new Date().toISOString(),
          status: 'unavailable',
          freshness_seconds: 0
        });
      }
      
      // Use yfinance spot price if Alpaca failed
      if (!spotPrice && optionsData.spot) {
        spotPrice = optionsData.spot;
        log(`💰 Using yfinance spot price for ${symbol}: $${spotPrice}`);
      }
    }

    // Track news source timestamp (news was provided by client)
    if (newsText && newsText.trim().length > 0) {
      dataSources.push({
        source: 'Finnhub',
        type: 'news',
        timestamp: new Date()
      });
      sourcesV2.push({
        type: 'news',
        provider: 'Finnhub',
        timestamp: new Date().toISOString(),
        status: 'ok',
        freshness_seconds: 0
      });
    }

    // Task 4: Calculate quant metrics if options available
    let gamma = { unavailable: true };
    let skew = { unavailable: true };
    let atmIV = null;
    let putCallRatio = null;
    let impliedMove = null;
    const hasOptionsData = optionsData.rows && optionsData.rows.length > 0;
    
    if (hasOptionsData && spotPrice) {
      gamma = calculateDealerGammaFromRows(optionsData.rows, spotPrice);
      skew = calculateSkewFromRows(optionsData.rows, spotPrice);
      atmIV = optionsData.atmIV;
      putCallRatio = optionsData.putCallVolumeRatio;
      impliedMove = optionsData.impliedMove;
      
      if (!gamma.unavailable) {
        log(`📊 Dealer Gamma: ${gamma.formatted}`);
      }
      if (!skew.unavailable) {
        log(`📊 Skew: ${skew.formatted}`);
      }
      
      // Log new metrics
      const atmIVStr = atmIV ? `${atmIV.percent}%` : 'null';
      const pcrStr = putCallRatio ? putCallRatio.ratio : 'null';
      const impMvStr = impliedMove ? `${impliedMove.pct}%` : 'null';
      log(`[METRICS] sym=${symbol} atm_iv=${atmIVStr} pcr=${pcrStr} impmv=${impMvStr}`);
    }

    // Task 6: Construct strict prompt with output template
    let prompt = `You are a financial analysis assistant. Analyze the following stock query and provide a structured response.

USER QUERY: ${query}

EVIDENCE:`;

    if (evidence.length > 0) {
      prompt += '\n' + evidence.map((e, i) => `${i + 1}. ${e}`).join('\n');
    } else {
      prompt += '\n(No specific evidence provided)';
    }

    // Add price data if available
    if (priceData) {
      prompt += `

MARKET DATA (${priceData.symbol}):
- Current: $${priceData.currentPrice}
- Previous Close: $${priceData.prevClose}
- Change: ${priceData.changePercent}% (${priceData.change > 0 ? '+' : ''}$${priceData.change.toFixed(2)})`;
    }

    // Add quant metrics if available
    const hasAnyQuant = !gamma.unavailable || !skew.unavailable || atmIV || putCallRatio || impliedMove;
    const isStaleData = optionsData.isStale || false;
    const dataAge = isStaleData && optionsData.cacheAge ? Math.round(optionsData.cacheAge / 60000) : 0; // minutes
    
    if (hasAnyQuant) {
      const dataAgeNote = isStaleData ? ` (cached ${dataAge} min ago)` : '';
      prompt += `

QUANT METRICS${dataAgeNote}:`;
      if (!gamma.unavailable) {
        prompt += `\n- Dealer Gamma (0-30d): ${gamma.formatted}`;
      }
      if (!skew.unavailable) {
        prompt += `\n- Skew (±10% OTM): ${skew.formatted} (Put IV: ${skew.putIV}%, Call IV: ${skew.callIV}%)`;
      }
      if (atmIV) {
        prompt += `\n- ATM IV: ${atmIV.percent}% @ strike ${atmIV.strike}`;
      }
      if (putCallRatio) {
        prompt += `\n- Put/Call Volume Ratio: ${putCallRatio.ratio}`;
      }
      if (impliedMove) {
        prompt += `\n- Implied Move (ATM straddle): $${impliedMove.abs} (${impliedMove.pct}%)`;
      }
    }

    // Task 6: Strict output formatting instructions
    // Build Quant instruction dynamically based on available metrics
    let quantParts = [];
    if (!gamma.unavailable) quantParts.push('Dealer Gamma (0-30d): X.XB (short/long)');
    if (!skew.unavailable) quantParts.push('Skew (±10%): X.X pp');
    if (atmIV) quantParts.push('ATM IV: X.X%@strike');
    if (putCallRatio) quantParts.push('Put/Call Vol Ratio: X.XX');
    if (impliedMove) quantParts.push('Implied Move: $X.XX (X.X%)');
    
    const hasQuant = quantParts.length > 0;
    const cacheNote = isStaleData && dataAge > 0 ? ` (cached ${dataAge} min ago)` : '';
    const quantInstruction = hasQuant 
      ? ` Include one line with quant metrics in format: "Quant${cacheNote}: ${quantParts.join('; ')}"`
      : '';
    
    const optionsNote = !hasQuant && hasOptionsData === false
      ? '\n\nNote: Options data unavailable (no licensed options feed configured).'
      : '';

    prompt += `

INSTRUCTIONS:
1. Use ONLY the provided evidence and numbers above. If insufficient, state "insufficient evidence" in overview.
2. NEVER recommend buy/sell/hold or give personal advice.
3. Keep it concise; no markdown headers or emojis; no bullet lists in sentiment lines.
4. ALWAYS include exactly three lines starting with "BULLISH:", "BEARISH:", and "NEUTRAL:".

OUTPUT FORMAT (follow exactly):

<Write 2-4 sentence overview explaining the situation.${quantInstruction}>

BULLISH: <1-2 sentences tied to evidence/metrics explaining positive perspective>

BEARISH: <1-2 sentences tied to evidence/metrics explaining negative perspective>

NEUTRAL: <1-2 sentences tied to evidence/metrics explaining wait-and-see perspective>${optionsNote}

Now provide your analysis:`;

    // Call Claude API with structured output and retry logic
    let claudeResult = null;
    let parseStatus = 'ok';
    let retryCount = 0;
    const maxRetries = 1;

    // Attempt 1: Try structured output
    try {
      log('🤖 Calling Claude with structured output (attempt 1)...');
      claudeResult = await callClaudeAPI(prompt, true);
      
      if (!claudeResult.data.structured) {
        log('⚠️  Structured output missing, attempting retry...');
        throw new Error('Structured output not returned');
      }
      
      log('✅ Received structured output from Claude');
    } catch (error) {
      log(`⚠️  Structured output failed: ${error.message}`);
      
      // Attempt 2: Retry once
      if (retryCount < maxRetries) {
        retryCount++;
        try {
          log('🔄 Retrying Claude call with structured output (attempt 2)...');
          claudeResult = await callClaudeAPI(prompt, true);
          
          if (!claudeResult.data.structured) {
            log('⚠️  Structured output still missing, falling back to text parsing...');
            throw new Error('Structured output not returned on retry');
          }
          
          log('✅ Received structured output from Claude on retry');
          parseStatus = 'coerced';
        } catch (retryError) {
          log(`❌ Retry failed: ${retryError.message}, falling back to legacy text parsing`);
          parseStatus = 'fallback_legacy';
        }
      }
    }

    // If both structured attempts failed, try without structured output
    if (!claudeResult || !claudeResult.data.structured) {
      try {
        log('🔄 Calling Claude without structured output (fallback)...');
        claudeResult = await callClaudeAPI(prompt, false);
        parseStatus = 'fallback_legacy';
      } catch (fallbackError) {
        log(`❌ /analyze - All Claude attempts failed: ${fallbackError.message}`);
        
        // Return generic fallback
        const fallbackText = "Several markets have seen movement today. Ask me about a stock to begin, then select a sentiment below to guide the discussion.\n\nBULLISH: Market conditions may present opportunities.\n\nBEARISH: Caution is warranted in current conditions.\n\nNEUTRAL: Consider waiting for more clarity before taking action.";
        
        return res.json({
          success: true,
          schema_version: "2.0",
          analysis: fallbackText,
          analysis_v2: validateAnalysisV2({
            intro: fallbackText,
            bullish: "Market conditions may present opportunities.",
            bearish: "Caution is warranted in current conditions.",
            neutral: "Consider waiting for more clarity before taking action."
          }, {
            ticker: symbol,
            sources: sourcesV2,
            parseStatus: 'fallback_legacy'
          }),
          usage: {
            input_tokens: 0,
            output_tokens: 0
          }
        });
      }
    }

    // Build analysis_v2 from structured or parsed text
    let rawAnalysis = null;
    if (claudeResult.data.structured) {
      rawAnalysis = claudeResult.data.structured;
    } else if (claudeResult.data.text) {
      // Parse legacy text format
      rawAnalysis = parseFromLegacyText(claudeResult.data.text);
    }

    // Validate and build analysis_v2
    const analysisV2 = validateAnalysisV2(rawAnalysis, {
      ticker: symbol,
      sources: sourcesV2,
      parseStatus
    });

    // Build legacy analysis text
    const legacyAnalysis = buildLegacyText(analysisV2, dataSources);

    // Single-line logging of data pipeline
    const priceSource = priceData ? 'Alpaca' : (optionsData.spot ? 'yfinance' : 'none');
    const optionsSource = (optionsData.rows && optionsData.rows.length > 0) ? 'yfinance-local' : 'none';
    const gammaStatus = !gamma.unavailable ? 'ok' : 'na';
    const skewStatus = !skew.unavailable ? 'ok' : 'na';
    log(`[INFO] symbol=${symbol || 'none'} price=${priceSource} options=${optionsSource} gamma=${gammaStatus} skew=${skewStatus} parse=${parseStatus}`);
    
    log('✅ /analyze - Analysis completed successfully');

    // Return response with both schemas
    res.json({
      success: true,
      schema_version: "2.0",
      analysis: legacyAnalysis,
      analysis_v2: analysisV2,
      usage: {
        input_tokens: claudeResult.usage.input_tokens || 0,
        output_tokens: claudeResult.usage.output_tokens || 0
      }
    });

  } catch (error) {
    // Task 7: Final catch-all - return fallback instead of 500 error
    log(`❌ /analyze - Unexpected error: ${error.message}`);
    
    const fallbackText = "Several markets have seen movement today. Ask me about a stock to begin, then select a sentiment below to guide the discussion.\n\nBULLISH: Market conditions may present opportunities.\n\nBEARISH: Caution is warranted in current conditions.\n\nNEUTRAL: Consider waiting for more clarity before taking action.";
    
    res.json({
      success: true,
      schema_version: "2.0",
      analysis: fallbackText,
      analysis_v2: validateAnalysisV2({
        intro: fallbackText,
        bullish: "Market conditions may present opportunities.",
        bearish: "Caution is warranted in current conditions.",
        neutral: "Consider waiting for more clarity before taking action."
      }, {
        ticker: null,
        sources: [],
        parseStatus: 'fallback_legacy'
      }),
      usage: {
        input_tokens: 0,
        output_tokens: 0
      }
    });
  }
});

// GET /news/:symbol - Fetch recent news for a stock
app.get('/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();

    log(`📰 /news/${upperSymbol} - Fetching news`);

    // Get date range (last 24 hours)
    const { from, to } = getDateRange();

    // Call Finnhub API
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${upperSymbol}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`
    );

    if (!response.ok) {
      log(`❌ /news/${upperSymbol} - Finnhub API error: HTTP ${response.status}`);
      return res.status(response.status).json({
        error: 'Finnhub API error',
        message: `HTTP ${response.status}: ${response.statusText}`
      });
    }

    const data = await response.json();

    if (data.error) {
      log(`❌ /news/${upperSymbol} - Finnhub error: ${data.error}`);
      return res.status(401).json({
        error: 'Finnhub API error',
        message: data.error
      });
    }

    // Format and limit to 10 most recent articles
    const articles = data
      .slice(0, 10)
      .map(article => ({
        headline: article.headline,
        summary: article.summary,
        datetime: article.datetime,
        source: article.source,
        url: article.url
      }));

    log(`✅ /news/${upperSymbol} - Found ${articles.length} articles`);

    res.json({
      success: true,
      symbol: upperSymbol,
      count: articles.length,
      dateRange: { from, to },
      articles
    });

  } catch (error) {
    log(`❌ /news/${req.params.symbol} - Error: ${error.message}`);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET /test/claude - Test Claude API key
app.get('/test/claude', async (req, res) => {
  try {
    log('🧪 /test/claude - Testing Claude API');

    if (!CLAUDE_API_KEY) {
      log('❌ /test/claude - API key not configured');
      return res.status(401).json({
        status: 'error',
        message: 'Claude API key not configured',
        response: null
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: 'Hello, respond with "API Working"'
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      const errorMsg = error.error?.message || 'Unknown error';
      log(`❌ /test/claude - Failed: ${errorMsg}`);
      return res.status(response.status).json({
        status: 'error',
        message: errorMsg,
        response: null
      });
    }

    const data = await response.json();
    log('✅ /test/claude - Success');

    res.json({
      status: 'success',
      message: 'Claude API is working correctly',
      response: data.content[0].text
    });

  } catch (error) {
    log(`❌ /test/claude - Error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: error.message,
      response: null
    });
  }
});

// GET /test/finnhub - Test Finnhub API key
app.get('/test/finnhub', async (req, res) => {
  try {
    log('🧪 /test/finnhub - Testing Finnhub API');

    if (!FINNHUB_API_KEY) {
      log('❌ /test/finnhub - API key not configured');
      return res.status(401).json({
        status: 'error',
        message: 'Finnhub API key not configured',
        count: 0,
        sample_headline: null
      });
    }

    const { from, to } = getDateRange();
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=AAPL&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`
    );

    if (!response.ok) {
      log(`❌ /test/finnhub - Failed: HTTP ${response.status}`);
      return res.status(response.status).json({
        status: 'error',
        message: `HTTP ${response.status}: ${response.statusText}`,
        count: 0,
        sample_headline: null
      });
    }

    const data = await response.json();

    if (data.error) {
      log(`❌ /test/finnhub - Failed: ${data.error}`);
      return res.status(401).json({
        status: 'error',
        message: data.error,
        count: 0,
        sample_headline: null
      });
    }

    log('✅ /test/finnhub - Success');

    res.json({
      status: 'success',
      message: 'Finnhub API is working correctly',
      count: data.length,
      sample_headline: data[0]?.headline || 'No headlines available'
    });

  } catch (error) {
    log(`❌ /test/finnhub - Error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: error.message,
      count: 0,
      sample_headline: null
    });
  }
});

// GET /test/all - Test all API keys
app.get('/test/all', async (req, res) => {
  try {
    log('🧪 /test/all - Testing all APIs');

    // Test both APIs in parallel
    const [claudeResult, finnhubResult] = await Promise.all([
      testClaudeAPI(),
      testFinnhubAPI()
    ]);

    const allWorking = claudeResult.success && finnhubResult.success;

    res.json({
      claude: {
        status: claudeResult.success ? 'success' : 'error',
        message: claudeResult.message
      },
      finnhub: {
        status: finnhubResult.success ? 'success' : 'error',
        message: finnhubResult.message
      },
      overall: allWorking ? 'all working' : 'some failed'
    });

    log(`✅ /test/all - Complete (${allWorking ? 'all working' : 'some failed'})`);

  } catch (error) {
    log(`❌ /test/all - Error: ${error.message}`);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET /test/options - Test options provider
app.get('/test/options', (req, res) => {
  log('🧪 /test/options - Checking options provider');
  res.json({
    provider: getOptionsProvider()
  });
});

// ==================== SERVER STARTUP ====================

// Start server and test API keys on startup
app.listen(PORT, async () => {
  log(`🚀 Server running on port ${PORT}`);
  log('');
  log('Testing API connections...');
  log('');

  // Test Claude API
  const claudeTest = await testClaudeAPI();
  if (claudeTest.success) {
    log(`✅ Claude API: Connected`);
  } else {
    log(`❌ Claude API: Error - ${claudeTest.message}`);
  }

  // Test Finnhub API
  const finnhubTest = await testFinnhubAPI();
  if (finnhubTest.success) {
    log(`✅ Finnhub API: Connected (${finnhubTest.count} test articles found)`);
  } else {
    log(`❌ Finnhub API: Error - ${finnhubTest.message}`);
  }

  log('');
  log('API is ready to accept requests');
  log('');
  
  // Initialize cache warmer for popular symbols
  // This ensures quant data is available immediately after server restart
  log('🔥 Initializing options cache warmer...');
  initCacheWarmer({
    immediate: true,    // Start warming cache now (in background)
    background: true,   // Enable periodic refresh every 2 hours
    sequential: true    // Fetch one symbol at a time (safer for free tier)
  }).catch(err => {
    log(`⚠️  Cache warmer initialization error: ${err.message}`);
  });
});

