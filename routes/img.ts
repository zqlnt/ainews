/**
 * Image proxy route - /img?src=https://...
 */

import express from 'express';
import crypto from 'crypto';
import { fetchWithTimeout } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import { canonicalizeUrl } from '../lib/url.js';
import { getCurrentTimeISO } from '../lib/time.js';

const router = express.Router();

// Cache TTL for images
const IMAGE_CACHE_TTL_SEC = 86400; // 24 hours
const IMAGE_TIMEOUT_MS = 3000; // 3 seconds

// 1x1 transparent PNG placeholder (43 bytes)
const PLACEHOLDER_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/**
 * Generate ETag from content
 */
function generateETag(content: Buffer | string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * GET /img?src=https://...
 */
router.get('/', async (req, res) => {
  try {
    const srcUrl = req.query.src as string;
    
    if (!srcUrl) {
      res.status(400).json({ error: 'Missing src parameter' });
      return;
    }
    
    // Canonicalize URL (enforce https, strip tracking)
    const canonicalUrl = canonicalizeUrl(srcUrl);
    const cacheKey = `img:${canonicalUrl}`;
    
    // Try cache first
    const cached = cache.getFresh<{ buffer: Buffer; contentType: string }>(cacheKey);
    if (cached) {
      const etag = generateETag(cached.buffer);
      
      // Check If-None-Match
      const ifNoneMatch = req.get('If-None-Match');
      if (ifNoneMatch === etag) {
        res.status(304).end();
        return;
      }
      
      res.set({
        'Content-Type': cached.contentType,
        'Cache-Control': `public, max-age=${IMAGE_CACHE_TTL_SEC}`,
        'ETag': etag
      });
      
      res.send(cached.buffer);
      console.log(`[${getCurrentTimeISO()}] 🖼️  Served cached image`);
      return;
    }
    
    // Try fetching image
    try {
      console.log(`[${getCurrentTimeISO()}] 🖼️  Fetching image: ${canonicalUrl.substring(0, 60)}...`);
      
      const response = await fetchWithTimeout(canonicalUrl, {
        method: 'GET',
        timeout: IMAGE_TIMEOUT_MS
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      
      // Validate it's an image
      if (!contentType.startsWith('image/')) {
        throw new Error('Not an image');
      }
      
      // Optional: Cap size (e.g., 2MB max)
      const MAX_SIZE = 2 * 1024 * 1024;
      if (buffer.length > MAX_SIZE) {
        console.log(`[${getCurrentTimeISO()}] ⚠️  Image too large (${Math.round(buffer.length / 1024)}KB), using placeholder`);
        throw new Error('Image too large');
      }
      
      // Cache it
      cache.put(cacheKey, { buffer, contentType }, IMAGE_CACHE_TTL_SEC, IMAGE_CACHE_TTL_SEC);
      
      const etag = generateETag(buffer);
      
      // Check If-None-Match
      const ifNoneMatch = req.get('If-None-Match');
      if (ifNoneMatch === etag) {
        res.status(304).end();
        return;
      }
      
      res.set({
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${IMAGE_CACHE_TTL_SEC}`,
        'ETag': etag
      });
      
      res.send(buffer);
      console.log(`[${getCurrentTimeISO()}] ✅ Fetched and served image (${Math.round(buffer.length / 1024)}KB)`);
      
    } catch (error) {
      // Return placeholder on error
      console.log(`[${getCurrentTimeISO()}] ⚠️  Image fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}, serving placeholder`);
      
      const etag = generateETag(PLACEHOLDER_IMAGE);
      
      // Check If-None-Match
      const ifNoneMatch = req.get('If-None-Match');
      if (ifNoneMatch === etag) {
        res.status(304).end();
        return;
      }
      
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600', // Shorter cache for placeholder
        'ETag': etag,
        'X-Image-Status': 'fallback'
      });
      
      res.send(PLACEHOLDER_IMAGE);
    }
    
  } catch (error) {
    console.error(`[${getCurrentTimeISO()}] ❌ /img error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    // Return placeholder on any error
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60',
      'X-Image-Status': 'error'
    });
    
    res.send(PLACEHOLDER_IMAGE);
  }
});

export default router;

