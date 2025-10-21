/**
 * Simple in-memory SWR (stale-while-revalidate) cache
 */

/**
 * @template T
 * @typedef {Object} CacheEntry
 * @property {T} value
 * @property {number} timestamp
 * @property {number} freshTtlMs
 * @property {number} staleTtlMs
 */

class SWRCache {
  constructor() {
    /** @type {Map<string, CacheEntry<any>>} */
    this.cache = new Map();
  }

  /**
   * Store a value with fresh and stale TTLs
   * @template T
   * @param {string} key - Cache key
   * @param {T} value - Value to cache
   * @param {number} freshTtlSec - Fresh TTL in seconds
   * @param {number} staleTtlSec - Stale TTL in seconds
   * @returns {void}
   */
  put(key, value, freshTtlSec, staleTtlSec) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      freshTtlMs: freshTtlSec * 1000,
      staleTtlMs: staleTtlSec * 1000
    });
  }

  /**
   * Get value if fresh (within fresh TTL)
   * @template T
   * @param {string} key - Cache key
   * @returns {T | undefined} Value if fresh, undefined otherwise
   */
  getFresh(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    const age = Date.now() - entry.timestamp;
    if (age <= entry.freshTtlMs) {
      return entry.value;
    }

    return undefined;
  }

  /**
   * Get value if stale (within stale TTL, even if not fresh)
   * @template T
   * @param {string} key - Cache key
   * @returns {T | undefined} Value if within stale TTL, undefined otherwise
   */
  getStale(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    const age = Date.now() - entry.timestamp;
    if (age <= entry.staleTtlMs) {
      return entry.value;
    }

    // Remove expired entry
    this.cache.delete(key);
    return undefined;
  }

  /**
   * Get age of cached entry in seconds
   * @param {string} key - Cache key
   * @returns {number | undefined} Age in seconds, or undefined if not cached
   */
  ageSeconds(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    return Math.floor((Date.now() - entry.timestamp) / 1000);
  }

  /**
   * Clear all cache entries
   * @returns {void}
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Delete a specific cache entry
   * @param {string} key - Cache key
   * @returns {void}
   */
  delete(key) {
    this.cache.delete(key);
  }
}

// Export singleton instance
export const cache = new SWRCache();

