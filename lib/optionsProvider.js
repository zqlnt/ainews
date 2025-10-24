import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
const OPTIONS_PROVIDER = process.env.OPTIONS_PROVIDER || 'yfinance-local';
const OPT_MAX_DAYS = process.env.OPT_MAX_DAYS || '30';
const OPT_EXPIRIES = process.env.OPT_EXPIRIES || '5'; // Fetch 5 expiries to ensure we get non-expired ones
const OPT_CACHE_TTL_SEC = parseInt(process.env.OPT_CACHE_TTL_SEC || '14400'); // 4 hours default
const OPT_STALE_TTL_SEC = parseInt(process.env.OPT_STALE_TTL_SEC || '86400'); // 24 hours stale allowed
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const TIMEOUT_MS = parseInt(process.env.PYTHON_TIMEOUT_MS || '20000'); // 20 seconds for free tier (more time for 5 expiries)

// Simple in-memory cache
const optionsCache = new Map();

/**
 * Fetch options data for a symbol using local Python bridge
 * Implements stale-while-revalidate pattern: serves stale data if fresh fetch fails
 * @param {string} symbol - Stock symbol
 * @returns {Promise<{spot: number|null, rows: Array, fetchedAt: string, isStale?: boolean}>}
 */
export async function fetchOptions(symbol) {
  // If provider is not yfinance-local, return empty
  if (OPTIONS_PROVIDER !== 'yfinance-local') {
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

  // Try to fetch fresh data
  try {
    const scriptPath = path.join(__dirname, '..', 'pybridge', 'options_bridge.py');
    const args = [scriptPath, symbol, OPT_MAX_DAYS, OPT_EXPIRIES];

    const result = await runPythonBridge(PYTHON_BIN, args, TIMEOUT_MS);
    
    // If successful, update cache
    if (result.rows && result.rows.length > 0) {
      optionsCache.set(cacheKey, {
        data: result,
        timestamp: now
      });
      console.log(`[${new Date().toISOString()}] ✅ Fetched fresh options for ${symbol}: ${result.rows.length} rows`);
      return result;
    } else {
      console.log(`[${new Date().toISOString()}] ⚠️  Python bridge returned no valid options for ${symbol}`);
      // Fall through to check stale cache
    }

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Failed to fetch options for ${symbol}: ${error.message}`);
    // Fall through to check stale cache
  }

  // If fresh fetch failed, check if we have stale cache (< OPT_STALE_TTL_SEC)
  if (cached && (now - cached.timestamp < OPT_STALE_TTL_SEC * 1000)) {
    const ageMinutes = Math.round((now - cached.timestamp) / 60000);
    console.log(`[${new Date().toISOString()}] 🔄 Using stale cached options for ${symbol} (age: ${ageMinutes} min)`);
    return {
      ...cached.data,
      isStale: true,
      cacheAge: now - cached.timestamp
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

      // Log stderr if present (helps diagnose Yahoo Finance blocks)
      if (stderr && stderr.trim()) {
        console.log(`[${new Date().toISOString()}] 🐍 Python stderr: ${stderr.trim().substring(0, 200)}`);
      }

      try {
        const result = JSON.parse(stdout);
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
        if (stdout && stdout.trim()) {
          console.log(`[${new Date().toISOString()}] ⚠️  Python stdout (parse failed): ${stdout.trim().substring(0, 200)}`);
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

