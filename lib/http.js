/**
 * HTTP fetch wrapper with timeout and keep-alive
 */

import http from 'http';
import https from 'https';

// Keep-alive agents for connection pooling
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

/**
 * @typedef {Object} FetchOptions
 * @property {string} [method]
 * @property {Record<string, string>} [headers]
 * @property {string} [body]
 * @property {number} [timeout] - milliseconds
 */

/**
 * Fetch wrapper with timeout and keep-alive agents
 * @param {string} url - URL to fetch
 * @param {FetchOptions} [options] - Fetch options
 * @returns {Promise<Response>} Response object
 */
export async function fetchWithTimeout(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 4000 // default 4s timeout
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      // @ts-ignore - Node.js fetch supports agent
      agent: url.startsWith('https') ? httpsAgent : httpAgent
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    
    throw error;
  }
}

/**
 * Fetch JSON with timeout
 * @template T
 * @param {string} url - URL to fetch
 * @param {FetchOptions} [options] - Fetch options
 * @returns {Promise<T>} Parsed JSON response
 */
export async function fetchJSON(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}

