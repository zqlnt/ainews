import { fetchPolygonOptions } from './polygonProvider.js';

// Environment configuration
const OPTIONS_PROVIDER = process.env.OPTIONS_PROVIDER || 'polygon';

/**
 * Fetch options data for a symbol using Polygon.io
 * @param {string} symbol - Stock symbol
 * @returns {Promise<{spot: number|null, rows: Array, fetchedAt: string, isStale?: boolean}>}
 */
export async function fetchOptions(symbol) {
  if (OPTIONS_PROVIDER === 'polygon') {
    return await fetchPolygonOptions(symbol);
  }
  
  console.log(`[${new Date().toISOString()}] ⚠️  Unknown provider: ${OPTIONS_PROVIDER}, returning empty`);
  return { spot: null, rows: [], fetchedAt: new Date().toISOString() };
}

/**
 * Get current provider configuration
 * @returns {string} Current options provider
 */
export function getOptionsProvider() {
  return OPTIONS_PROVIDER;
}

