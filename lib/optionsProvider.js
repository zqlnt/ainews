import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment configuration
const OPTIONS_PROVIDER = process.env.OPTIONS_PROVIDER || 'yfinance-local';
const OPT_MAX_DAYS = process.env.OPT_MAX_DAYS || '30';
const OPT_EXPIRIES = process.env.OPT_EXPIRIES || '2';
const OPT_CACHE_TTL_SEC = parseInt(process.env.OPT_CACHE_TTL_SEC || '300');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const TIMEOUT_MS = 2500;

// Simple in-memory cache
const optionsCache = new Map();

/**
 * Fetch options data for a symbol using local Python bridge
 * @param {string} symbol - Stock symbol
 * @returns {Promise<{spot: number|null, rows: Array, fetchedAt: string}>}
 */
export async function fetchOptions(symbol) {
  // If provider is not yfinance-local, return empty
  if (OPTIONS_PROVIDER !== 'yfinance-local') {
    return { spot: null, rows: [], fetchedAt: new Date().toISOString() };
  }

  // Check cache
  const cacheKey = `${symbol}:${OPT_MAX_DAYS}:${OPT_EXPIRIES}`;
  const cached = optionsCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < OPT_CACHE_TTL_SEC * 1000)) {
    console.log(`[${new Date().toISOString()}] 📊 Using cached options for ${symbol}`);
    return cached.data;
  }

  try {
    const scriptPath = path.join(__dirname, '..', 'pybridge', 'options_bridge.py');
    const args = [scriptPath, symbol, OPT_MAX_DAYS, OPT_EXPIRIES];

    const result = await runPythonBridge(PYTHON_BIN, args, TIMEOUT_MS);
    
    // Cache the result
    optionsCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    if (result.rows && result.rows.length > 0) {
      console.log(`[${new Date().toISOString()}] ✅ Fetched options for ${symbol} via yfinance local bridge: ${result.rows.length} rows`);
    } else {
      console.log(`[${new Date().toISOString()}] ⚠️  yfinance local bridge returned no valid options for ${symbol}`);
    }

    return result;

  } catch (error) {
    // On any error, return empty result
    console.error(`[${new Date().toISOString()}] ❌ Failed to fetch options for ${symbol}: ${error.message}`);
    return { 
      spot: null, 
      rows: [], 
      fetchedAt: new Date().toISOString() 
    };
  }
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

      try {
        const result = JSON.parse(stdout);
        resolve({
          spot: result.spot,
          rows: result.rows || [],
          fetchedAt: result.fetched_at || new Date().toISOString()
        });
      } catch (parseError) {
        // If JSON parse fails, return empty
        resolve({
          spot: null,
          rows: [],
          fetchedAt: new Date().toISOString()
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

