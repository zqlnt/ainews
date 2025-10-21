/**
 * Unit tests for news helper functions
 */

import { strict as assert } from 'assert';
import { getAgeString, getCurrentTimeISO } from '../lib/time.js';
import { canonicalizeUrl, createDedupeKey } from '../lib/url.js';

console.log('🧪 Running News Helpers Tests...\n');

let passedTests = 0;
let failedTests = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ ${description}`);
    passedTests++;
  } catch (error) {
    console.error(`❌ ${description}`);
    console.error(`   Error: ${error.message}`);
    failedTests++;
  }
}

// ==================== Time Tests ====================

test('getCurrentTimeISO returns valid ISO 8601 string', () => {
  const iso = getCurrentTimeISO();
  assert.ok(iso);
  
  // Should be parseable as date
  const date = new Date(iso);
  assert.ok(!isNaN(date.getTime()));
  
  // Should match ISO format
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso));
});

test('getAgeString returns "0m" for current time', () => {
  const now = new Date().toISOString();
  const age = getAgeString(now);
  assert.equal(age, '0m');
});

test('getAgeString returns "5m" for 5 minutes ago', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const age = getAgeString(fiveMinutesAgo);
  assert.equal(age, '5m');
});

test('getAgeString returns "2h" for 2 hours ago', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const age = getAgeString(twoHoursAgo);
  assert.equal(age, '2h');
});

test('getAgeString returns "3d" for 3 days ago', () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const age = getAgeString(threeDaysAgo);
  assert.equal(age, '3d');
});

test('getAgeString handles invalid timestamp gracefully', () => {
  const age = getAgeString('invalid');
  assert.equal(age, '0m');
});

test('getAgeString prefers largest unit (days over hours)', () => {
  const oneDayOneHour = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const age = getAgeString(oneDayOneHour);
  assert.equal(age, '1d');
});

test('getAgeString prefers largest unit (hours over minutes)', () => {
  const oneHourTenMin = new Date(Date.now() - 70 * 60 * 1000).toISOString();
  const age = getAgeString(oneHourTenMin);
  assert.equal(age, '1h');
});

// ==================== URL Tests ====================

test('canonicalizeUrl enforces https', () => {
  const url = 'http://example.com/article';
  const canonical = canonicalizeUrl(url);
  assert.ok(canonical.startsWith('https://'));
  assert.equal(canonical, 'https://example.com/article');
});

test('canonicalizeUrl strips utm_source', () => {
  const url = 'https://example.com/article?utm_source=twitter&other=param';
  const canonical = canonicalizeUrl(url);
  assert.ok(!canonical.includes('utm_source'));
  assert.ok(canonical.includes('other=param'));
});

test('canonicalizeUrl strips utm_medium', () => {
  const url = 'https://example.com/article?utm_medium=social';
  const canonical = canonicalizeUrl(url);
  assert.ok(!canonical.includes('utm_medium'));
});

test('canonicalizeUrl strips utm_campaign', () => {
  const url = 'https://example.com/article?utm_campaign=spring';
  const canonical = canonicalizeUrl(url);
  assert.ok(!canonical.includes('utm_campaign'));
});

test('canonicalizeUrl strips fbclid', () => {
  const url = 'https://example.com/article?fbclid=abc123';
  const canonical = canonicalizeUrl(url);
  assert.ok(!canonical.includes('fbclid'));
});

test('canonicalizeUrl strips gclid', () => {
  const url = 'https://example.com/article?gclid=xyz789';
  const canonical = canonicalizeUrl(url);
  assert.ok(!canonical.includes('gclid'));
});

test('canonicalizeUrl strips ref parameter', () => {
  const url = 'https://example.com/article?ref=homepage';
  const canonical = canonicalizeUrl(url);
  assert.ok(!canonical.includes('ref'));
});

test('canonicalizeUrl strips multiple tracking params', () => {
  const url = 'https://example.com/article?utm_source=twitter&utm_medium=social&fbclid=abc&gclid=xyz&article_id=123';
  const canonical = canonicalizeUrl(url);
  assert.ok(!canonical.includes('utm_source'));
  assert.ok(!canonical.includes('utm_medium'));
  assert.ok(!canonical.includes('fbclid'));
  assert.ok(!canonical.includes('gclid'));
  assert.ok(canonical.includes('article_id=123')); // Keep non-tracking params
});

test('canonicalizeUrl handles empty string', () => {
  const canonical = canonicalizeUrl('');
  assert.equal(canonical, '');
});

test('canonicalizeUrl handles invalid URL gracefully', () => {
  const canonical = canonicalizeUrl('http://not a valid url');
  // Should replace http: with https:
  assert.ok(canonical.startsWith('https:'));
  
  // Completely invalid URLs are returned as-is
  const invalid = canonicalizeUrl('not-a-url');
  assert.equal(invalid, 'not-a-url');
});

test('canonicalizeUrl preserves path and query params (non-tracking)', () => {
  const url = 'https://example.com/path/to/article?id=123&category=tech';
  const canonical = canonicalizeUrl(url);
  assert.ok(canonical.includes('/path/to/article'));
  assert.ok(canonical.includes('id=123'));
  assert.ok(canonical.includes('category=tech'));
});

// ==================== Dedupe Key Tests ====================

test('createDedupeKey creates stable key from title + URL', () => {
  const title = 'Apple announces new iPhone';
  const url = 'https://example.com/article';
  const key = createDedupeKey(title, url);
  
  assert.ok(key);
  assert.ok(key.includes('apple announces new iphone')); // Normalized title
  assert.ok(key.includes('https://example.com/article'));
});

test('createDedupeKey normalizes title (lowercase, trim, collapse whitespace)', () => {
  const title1 = '  Apple   Announces  New  iPhone  ';
  const title2 = 'apple announces new iphone';
  const url = 'https://example.com/article';
  
  const key1 = createDedupeKey(title1, url);
  const key2 = createDedupeKey(title2, url);
  
  assert.equal(key1, key2);
});

test('createDedupeKey canonicalizes URL (strips tracking)', () => {
  const title = 'Apple announces new iPhone';
  const url1 = 'https://example.com/article?utm_source=twitter';
  const url2 = 'https://example.com/article';
  
  const key1 = createDedupeKey(title, url1);
  const key2 = createDedupeKey(title, url2);
  
  assert.equal(key1, key2);
});

test('createDedupeKey treats different titles as different', () => {
  const title1 = 'Apple announces new iPhone';
  const title2 = 'Google releases new Pixel';
  const url = 'https://example.com/article';
  
  const key1 = createDedupeKey(title1, url);
  const key2 = createDedupeKey(title2, url);
  
  assert.notEqual(key1, key2);
});

test('createDedupeKey treats different URLs as different', () => {
  const title = 'Apple announces new iPhone';
  const url1 = 'https://example.com/article1';
  const url2 = 'https://example.com/article2';
  
  const key1 = createDedupeKey(title, url1);
  const key2 = createDedupeKey(title, url2);
  
  assert.notEqual(key1, key2);
});

test('createDedupeKey handles empty title', () => {
  const title = '';
  const url = 'https://example.com/article';
  const key = createDedupeKey(title, url);
  
  assert.ok(key);
  assert.ok(key.includes('https://example.com/article'));
});

test('createDedupeKey separates title and URL with ::', () => {
  const title = 'Test Article';
  const url = 'https://example.com/test';
  const key = createDedupeKey(title, url);
  
  assert.ok(key.includes('::'));
});

// ==================== Results Summary ====================
console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
console.log('='.repeat(50));

if (failedTests > 0) {
  process.exit(1);
}

