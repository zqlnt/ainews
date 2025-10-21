/**
 * URL utilities for news processing
 */

/**
 * Canonicalize URLs: enforce https, strip common tracking params
 * @param {string} url - Input URL string
 * @returns {string} Canonicalized URL string
 */
export function canonicalizeUrl(url) {
  if (!url) return '';
  
  try {
    const parsed = new URL(url);
    
    // Enforce HTTPS
    parsed.protocol = 'https:';
    
    // Common tracking parameters to remove
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'mc_cid',
      'mc_eid',
      '_ga',
      'ref',
      'source'
    ];
    
    // Remove tracking params
    trackingParams.forEach(param => {
      parsed.searchParams.delete(param);
    });
    
    return parsed.toString();
  } catch {
    // If URL parsing fails, return cleaned string
    return url.replace(/^http:/, 'https:');
  }
}

/**
 * Create a stable dedupe key from title + canonical URL
 * @param {string} title - News item title
 * @param {string} url - News item URL
 * @returns {string} Dedupe key string
 */
export function createDedupeKey(title, url) {
  const canonicalUrl = canonicalizeUrl(url);
  const normalizedTitle = title.trim().toLowerCase().replace(/\s+/g, ' ');
  
  // Simple hash-like key: combine normalized title + canonical URL
  return `${normalizedTitle}::${canonicalUrl}`;
}
