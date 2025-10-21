/**
 * Unit tests for sentiment classification
 */

import { strict as assert } from 'assert';
import { classifySentiment, enrichWithSentiment } from '../lib/sentiment.js';

console.log('🧪 Running Sentiment Classification Tests...\n');

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

// ==================== Bullish Tests ====================

test('beats earnings → bullish', () => {
  const result = classifySentiment({ title: 'Apple beats Q3 earnings expectations' });
  assert.equal(result.label, 'bullish');
  assert.ok(result.score >= 2);
});

test('upgrade → bullish', () => {
  const result = classifySentiment({ title: 'Goldman Sachs upgrades NVDA to buy' });
  assert.equal(result.label, 'bullish');
  assert.ok(result.score >= 2);
});

test('raises guidance → bullish', () => {
  const result = classifySentiment({ title: 'Tesla raises guidance for full year' });
  assert.equal(result.label, 'bullish');
  assert.ok(result.score >= 2);
});

test('record profits → bullish', () => {
  const result = classifySentiment({ title: 'Microsoft reports record quarterly profit' });
  assert.equal(result.label, 'bullish');
  assert.ok(result.score >= 2);
});

test('strong demand → bullish', () => {
  const result = classifySentiment({ title: 'AMD sees strong demand for new chips' });
  assert.equal(result.label, 'bullish');
  assert.ok(result.score >= 2);
});

// ==================== Bearish Tests ====================

test('misses earnings → bearish', () => {
  const result = classifySentiment({ title: 'Netflix misses Q2 revenue targets' });
  assert.equal(result.label, 'bearish');
  assert.ok(result.score <= -2);
});

test('downgrade → bearish', () => {
  const result = classifySentiment({ title: 'Analyst downgrades META stock' });
  assert.equal(result.label, 'bearish');
  assert.ok(result.score <= -2);
});

test('cuts guidance → bearish', () => {
  const result = classifySentiment({ title: 'Intel cuts full-year guidance' });
  assert.equal(result.label, 'bearish');
  assert.ok(result.score <= -2);
});

test('SEC investigation → bearish', () => {
  const result = classifySentiment({ title: 'Company faces SEC investigation' });
  assert.equal(result.label, 'bearish');
  assert.ok(result.score <= -2);
});

test('weak demand → bearish', () => {
  const result = classifySentiment({ title: 'Automaker sees weak demand in Q3' });
  assert.equal(result.label, 'bearish');
  assert.ok(result.score <= -2);
});

test('layoffs announced → bearish', () => {
  const result = classifySentiment({ title: 'Tech company announces major layoffs' });
  assert.equal(result.label, 'bearish');
  assert.ok(result.score <= -2);
});

// ==================== Negation Tests ====================

test('lawsuit dismissed → not bearish', () => {
  const result = classifySentiment({ title: 'Judge dismisses shareholder lawsuit' });
  assert.notEqual(result.label, 'bearish');
  assert.ok(result.score > -2); // Should flip bearish weight
});

test('probe dropped → not bearish', () => {
  const result = classifySentiment({ title: 'Federal probe dropped after review' });
  assert.notEqual(result.label, 'bearish');
  assert.ok(result.score > -2);
});

test('downgrade reversed → not bearish', () => {
  const result = classifySentiment({ title: 'Analyst reverses downgrade to neutral' });
  assert.notEqual(result.label, 'bearish');
});

// ==================== Mixed Signals Tests ====================

test('beats EPS but cuts guidance → bearish (guidance dominates)', () => {
  const result = classifySentiment({ 
    title: 'Company beats EPS but cuts full-year guidance' 
  });
  assert.equal(result.label, 'bearish');
  // Guidance scored -3, beats scored +2, net = -1 but might have other bearish signals
});

test('upgrade and strong sales → very bullish', () => {
  const result = classifySentiment({ 
    title: 'Analysts upgrade stock citing strong sales growth' 
  });
  assert.equal(result.label, 'bullish');
  assert.ok(result.score >= 4); // Multiple bullish signals
});

test('miss but raises guidance → bullish (guidance dominates)', () => {
  const result = classifySentiment({ 
    title: 'Company misses Q3 but raises full-year guidance' 
  });
  assert.equal(result.label, 'bullish');
  // Raises guidance +3, miss -2, net = +1 (plus guidance priority)
});

// ==================== Balanced/Neutral Tests ====================

test('no strong keywords → neutral', () => {
  const result = classifySentiment({ title: 'Company announces quarterly results' });
  assert.equal(result.label, 'neutral');
  assert.ok(result.score > -2 && result.score < 2);
});

test('equal bullish/bearish signals → neutral', () => {
  const result = classifySentiment({ 
    title: 'Stock upgrade amid weak demand concerns' 
  });
  // Upgrade +2, weak demand -2 = 0
  assert.equal(result.label, 'neutral');
});

test('meets expectations → neutral', () => {
  const result = classifySentiment({ title: 'Company meets analyst expectations' });
  assert.equal(result.label, 'neutral');
});

// ==================== Edge Cases ====================

test('empty title → neutral', () => {
  const result = classifySentiment({ title: '' });
  assert.equal(result.label, 'neutral');
  assert.equal(result.score, 0);
});

test('title with summary considers both', () => {
  const result = classifySentiment({ 
    title: 'Company announces results',
    summary: 'The company beat estimates and raised guidance'
  });
  assert.equal(result.label, 'bullish');
});

test('case insensitive matching', () => {
  const upper = classifySentiment({ title: 'COMPANY BEATS EARNINGS' });
  const lower = classifySentiment({ title: 'company beats earnings' });
  const mixed = classifySentiment({ title: 'Company Beats Earnings' });
  
  assert.equal(upper.label, 'bullish');
  assert.equal(lower.label, 'bullish');
  assert.equal(mixed.label, 'bullish');
});

test('word boundaries prevent partial matches', () => {
  // "greatest" shouldn't match "beat"
  const result = classifySentiment({ title: 'The greatest innovator of our time' });
  assert.equal(result.label, 'neutral');
});

// ==================== enrichWithSentiment Tests ====================

test('enrichWithSentiment adds sentiment fields', () => {
  const newsItem = {
    title: 'Apple beats earnings',
    source: 'Reuters',
    url: 'https://example.com'
  };
  
  const enriched = enrichWithSentiment(newsItem);
  
  assert.ok(enriched.sentiment);
  assert.equal(enriched.sentiment, 'bullish');
  assert.equal(enriched.sentiment_source, 'heuristic');
  assert.equal(enriched.sentiment_version, 'news-v1');
  assert.equal(enriched.title, newsItem.title);
  assert.equal(enriched.source, newsItem.source);
});

test('enrichWithSentiment preserves existing fields', () => {
  const newsItem = {
    title: 'Neutral news',
    source: 'Bloomberg',
    url: 'https://example.com',
    image: '/img/test.jpg',
    tickers: ['AAPL']
  };
  
  const enriched = enrichWithSentiment(newsItem);
  
  assert.equal(enriched.image, newsItem.image);
  assert.deepEqual(enriched.tickers, newsItem.tickers);
});

// ==================== Version Tests ====================

test('classification returns version', () => {
  const result = classifySentiment({ title: 'Test news' });
  assert.equal(result.version, 'news-v1');
});

test('classification returns reason', () => {
  const result = classifySentiment({ title: 'Company beats earnings' });
  assert.ok(result.reason);
  assert.ok(typeof result.reason === 'string');
});

// ==================== Results Summary ====================
console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
console.log('='.repeat(50));

if (failedTests > 0) {
  process.exit(1);
}

