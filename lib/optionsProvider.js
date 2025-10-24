import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchPolygonOptions } from './polygonProvider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
const OPTIONS_PROVIDER = process.env.OPTIONS_PROVIDER || 'polygon';
const OPT_MAX_DAYS = process.env.OPT_MAX_DAYS || '30';
const OPT_EXPIRIES = process.env.OPT_EXPIRIES || '2'; // Fetch 2 expiries (reduced to minimize Yahoo requests)
const OPT_CACHE_TTL_SEC = parseInt(process.env.OPT_CACHE_TTL_SEC || '14400'); // 4 hours default
const OPT_STALE_TTL_SEC = parseInt(process.env.OPT_STALE_TTL_SEC || '86400'); // 24 hours stale allowed
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const TIMEOUT_MS = parseInt(process.env.PYTHON_TIMEOUT_MS || '30000'); // 30 seconds (increased to handle rate limiting delays)

// Simple in-memory cache
const optionsCache = new Map();

// Global rate limiter - ensures requests are serialized and spaced out
const MIN_REQUEST_SPACING_MS = 2000; // Minimum 2 seconds between Yahoo requests
let lastRequestTime = 0;
let requestQueue = Promise.resolve();

// Request deduplication - prevents parallel requests for same ticker
const pendingRequests = new Map();

/**
 * Fetch options data for a symbol
 * Supports multiple providers: polygon, yfinance-local
 * Implements:
 * - Stale-while-revalidate pattern: serves stale data if fresh fetch fails
 * - Global rate limiting: serializes all Yahoo requests with minimum spacing
 * - Request deduplication: prevents parallel requests for same ticker
 * - Retry logic: exponential backoff for 429/5xx errors
 * @param {string} symbol - Stock symbol
 * @returns {Promise<{spot: number|null, rows: Array, fetchedAt: string, isStale?: boolean}>}
 */
export async function fetchOptions(symbol) {
  // Route to appropriate provider
  if (OPTIONS_PROVIDER === 'polygon') {
    console.log(`[${new Date().toISOString()}] ⚠️  Polygon requires paid tier for options data, falling back to yfinance`);
    // Fall through to yfinance
  } else if (OPTIONS_PROVIDER !== 'yfinance-local') {
    console.log(`[${new Date().toISOString()}] ⚠️  Unknown provider: ${OPTIONS_PROVIDER}, returning empty`);
    return { spot: null, rows: [], fetchedAt: new Date().toISOString() };
  }

  // Check cache
  const cacheKey = `${symbol}:${OPT_MAX_DAYS}:${OPT_EXPIRIES}`;
  const cached = optionsCache.get(cacheKey);
  const now = Date.now();
  
  // If fresh cache exists (< OPT_CACHE_TTL_SEC), return immediately
  if (cached && (now - cached.timestamp < OPT_CACHE_TTL_SEC * 1000)) {
    console.log(`[${new Date().toISOString()}] 📊 Using fresh cached options for ${symbol} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
    return cached.data;
  }

  // Request deduplication: if there's already a pending request for this symbol, wait for it
  if (pendingRequests.has(symbol)) {
    console.log(`[${new Date().toISOString()}] ⏳ Waiting for existing request for ${symbol}...`);
    return await pendingRequests.get(symbol);
  }

  // Create a promise for this request and store it for deduplication
  const fetchPromise = (async () => {
    try {
      // Fetch with retry logic
      const result = await fetchWithRetry(symbol, 2); // Max 2 retries
      
      // If successful, update cache
      if (result.rows && result.rows.length > 0) {
        optionsCache.set(cacheKey, {
          data: result,
          timestamp: Date.now()
        });
        console.log(`[${new Date().toISOString()}] ✅ Fetched fresh options for ${symbol}: ${result.rows.length} rows`);
        return result;
      } else {
        console.log(`[${new Date().toISOString()}] ⚠️  Python bridge returned no valid options for ${symbol}`);
        // Fall through to stale cache check
      }

    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Failed to fetch options for ${symbol}: ${error.message}`);
      // Fall through to stale cache check
    }

    // If fresh fetch failed, check if we have stale cache (< OPT_STALE_TTL_SEC)
    if (cached && (Date.now() - cached.timestamp < OPT_STALE_TTL_SEC * 1000)) {
      const ageMinutes = Math.round((Date.now() - cached.timestamp) / 60000);
      console.log(`[${new Date().toISOString()}] 🔄 Using stale cached options for ${symbol} (age: ${ageMinutes} min)`);
      return {
        ...cached.data,
        isStale: true,
        cacheAge: Date.now() - cached.timestamp
      };
    }

    // No cache available, return empty
    console.log(`[${new Date().toISOString()}] ❌ No options data available for ${symbol} (no cache)`);
    return { 
      spot: null, 
      rows: [], 
      fetchedAt: new Date().toISOString(),
      atmIV: null,
      putCallVolumeRatio: null,
      impliedMove: null
    };
  })();

  // Store the pending request
  pendingRequests.set(symbol, fetchPromise);
  
  // Clean up after completion
  fetchPromise.finally(() => {
    pendingRequests.delete(symbol);
  });

  return await fetchPromise;
}

/**
 * Fetch options with retry logic and exponential backoff
 * Implements global rate limiting to space out Yahoo requests
 * @param {string} symbol - Stock symbol
 * @param {number} maxRetries - Maximum number of retry attempts
 * @returns {Promise<{spot: number|null, rows: Array, fetchedAt: string}>}
 */
async function fetchWithRetry(symbol, maxRetries = 2) {
  const scriptPath = path.join(__dirname, '..', 'pybridge', 'options_bridge.py');
  const args = [scriptPath, symbol, OPT_MAX_DAYS, OPT_EXPIRIES];
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Global rate limiting: ensure minimum spacing between requests
      // Queue this request to run serially
      const result = await new Promise((resolve, reject) => {
        requestQueue = requestQueue.then(async () => {
          try {
            // Calculate required delay to maintain minimum spacing
            const now = Date.now();
            const timeSinceLastRequest = now - lastRequestTime;
            const delayNeeded = Math.max(0, MIN_REQUEST_SPACING_MS - timeSinceLastRequest);
            
            if (delayNeeded > 0) {
              console.log(`[${new Date().toISOString()}] ⏱️  Rate limiting: waiting ${delayNeeded}ms before ${symbol} request`);
              await new Promise(r => setTimeout(r, delayNeeded));
            }
            
            // Update last request time
            lastRequestTime = Date.now();
            
            // Make the actual request
            console.log(`[${new Date().toISOString()}] 🔄 Attempt ${attempt + 1}/${maxRetries + 1} for ${symbol}`);
            const data = await runPythonBridge(PYTHON_BIN, args, TIMEOUT_MS);
            resolve(data);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      // Success! Return the result
      return result;
      
    } catch (error) {
      const isLastAttempt = attempt === maxRetries;
      
      // Check if it's a retryable error (timeout, rate limit, server error)
      const isRetryable = error.message.includes('timeout') || 
                          error.message.includes('429') || 
                          error.message.includes('5') && error.message.includes('error');
      
      if (isLastAttempt || !isRetryable) {
        console.error(`[${new Date().toISOString()}] ❌ Final attempt failed for ${symbol}: ${error.message}`);
        throw error;
      }
      
      // Exponential backoff: 2^attempt seconds
      const backoffSeconds = Math.pow(2, attempt);
      const backoffMs = backoffSeconds * 1000;
      console.log(`[${new Date().toISOString()}] ⏳ Retry ${attempt + 1} failed for ${symbol}, backing off ${backoffSeconds}s...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }
  
  // Should never reach here, but just in case
  throw new Error('Max retries exceeded');
}

/**
 * Run Python bridge with timeout
 * @param {string} pythonBin - Python binary path
 * @param {Array<string>} args - Command arguments
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<{spot: number|null, rows: Array, fetchedAt: string}>}
 */
function runPythonBridge(pythonBin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(pythonBin, args);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new Error('Python bridge timeout'));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        return;
      }

      // ALWAYS log what we got from Python for debugging
      console.log(`[${new Date().toISOString()}] 🐍 Python exit code: ${code}, stdout length: ${stdout.length}, stderr length: ${stderr.length}`);
      
      // Log stderr if present (helps diagnose Yahoo Finance blocks)
      if (stderr && stderr.trim()) {
        console.log(`[${new Date().toISOString()}] 🐍 Python stderr: ${stderr.trim().substring(0, 500)}`);
      }

      try {
        const result = JSON.parse(stdout);
        const rowCount = (result.rows || []).length;
        console.log(`[${new Date().toISOString()}] 🐍 Parsed JSON: spot=${result.spot}, rows=${rowCount}`);
        resolve({
          spot: result.spot,
          rows: result.rows || [],
          fetchedAt: result.fetched_at || new Date().toISOString(),
          atmIV: result.atm_iv || null,
          putCallVolumeRatio: result.put_call_volume_ratio || null,
          impliedMove: result.implied_move || null
        });
      } catch (parseError) {
        // If JSON parse fails, log for debugging and return empty
        console.log(`[${new Date().toISOString()}] ⚠️  Python JSON parse failed: ${parseError.message}`);
        if (stdout && stdout.trim()) {
          console.log(`[${new Date().toISOString()}] ⚠️  Python stdout (parse failed): ${stdout.trim().substring(0, 500)}`);
        }
        resolve({
          spot: null,
          rows: [],
          fetchedAt: new Date().toISOString(),
          atmIV: null,
          putCallVolumeRatio: null,
          impliedMove: null
        });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Get current provider configuration
 * @returns {string} Current options provider
 */
export function getOptionsProvider() {
  return OPTIONS_PROVIDER;
}

