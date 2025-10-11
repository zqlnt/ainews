import { strict as assert } from 'assert';
import { 
  validateAnalysisV2, 
  parseFromLegacyText,
  buildLegacyText 
} from '../lib/analysisValidator.js';

/**
 * Test Suite for Analysis Validator
 */

console.log('🧪 Running Analysis Validator Tests...\n');

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

// ==================== Test 1: All Sections Present ====================
test('Test 1: All sections present with valid data', () => {
  const raw = {
    intro: "Test intro with some context.",
    bullish: "Bullish perspective here.",
    bearish: "Bearish perspective here.",
    neutral: "Neutral perspective here.",
    confidence: {
      bullish: 0.75,
      bearish: 0.45,
      neutral: 0.30
    }
  };

  const sources = [
    { type: 'price', provider: 'Alpaca', timestamp: new Date().toISOString(), status: 'ok', freshness_seconds: 0 }
  ];

  const result = validateAnalysisV2(raw, { ticker: 'AAPL', sources, parseStatus: 'ok' });

  assert.equal(result.intro, 'Test intro with some context.');
  assert.equal(result.bullish, 'Bullish perspective here.');
  assert.equal(result.bearish, 'Bearish perspective here.');
  assert.equal(result.neutral, 'Neutral perspective here.');
  assert.equal(result.meta.ticker, 'AAPL');
  assert.equal(result.meta.confidence.bullish, 0.75);
  assert.equal(result.meta.confidence.bearish, 0.45);
  assert.equal(result.meta.confidence.neutral, 0.30);
  assert.equal(result.meta.parse_status, 'ok');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].provider, 'Alpaca');
});

// ==================== Test 2: One or More Sections Null ====================
test('Test 2: Some sections null should be handled gracefully', () => {
  const raw = {
    intro: "Only intro present.",
    bullish: null,
    bearish: "Bearish only.",
    neutral: null
  };

  const result = validateAnalysisV2(raw, { ticker: 'TSLA', sources: [], parseStatus: 'ok' });

  assert.equal(result.intro, 'Only intro present.');
  assert.equal(result.bullish, null);
  assert.equal(result.bearish, 'Bearish only.');
  assert.equal(result.neutral, null);
  
  // Confidence should be computed as fallback: null → 0.0, present → 0.6
  assert.equal(result.meta.confidence.bullish, 0.0);
  assert.equal(result.meta.confidence.bearish, 0.6);
  assert.equal(result.meta.confidence.neutral, 0.0);
});

// ==================== Test 3: Malformed JSON Coerced to Nulls ====================
test('Test 3: Malformed/missing fields coerced to null', () => {
  const raw = {
    intro: "",  // Empty string
    bullish: 123,  // Wrong type (number instead of string)
    bearish: undefined,
    neutral: null
  };

  const result = validateAnalysisV2(raw, { ticker: 'NVDA', sources: [], parseStatus: 'coerced' });

  // Empty string should be coerced to null
  assert.equal(result.intro, null);
  
  // Wrong type should be coerced to null
  assert.equal(result.bullish, null);
  assert.equal(result.bearish, null);
  assert.equal(result.neutral, null);
  
  // All confidence should be 0.0 (all sections null)
  assert.equal(result.meta.confidence.bullish, 0.0);
  assert.equal(result.meta.confidence.bearish, 0.0);
  assert.equal(result.meta.confidence.neutral, 0.0);
  assert.equal(result.meta.parse_status, 'coerced');
});

// ==================== Test 4: Sources Present and Valid ====================
test('Test 4: Sources array validated correctly', () => {
  const sources = [
    { type: 'price', provider: 'Alpaca', timestamp: new Date().toISOString(), status: 'ok', freshness_seconds: 0 },
    { type: 'options', provider: 'yfinance', timestamp: new Date().toISOString(), status: 'stale', freshness_seconds: 0 },
    { type: 'news', provider: 'Finnhub', timestamp: new Date().toISOString(), status: 'ok', freshness_seconds: 0 }
  ];

  const result = validateAnalysisV2({ intro: "Test" }, { ticker: 'SPY', sources, parseStatus: 'ok' });

  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[0].type, 'price');
  assert.equal(result.sources[0].status, 'ok');
  assert.equal(result.sources[1].type, 'options');
  assert.equal(result.sources[1].status, 'stale');
  assert.equal(result.sources[2].type, 'news');
  
  // Freshness should be computed (near zero since just created)
  assert.ok(result.sources[0].freshness_seconds >= 0);
  assert.ok(result.sources[0].freshness_seconds < 5); // Should be very recent
});

// ==================== Test 5: Confidence Clamped to [0, 1] ====================
test('Test 5: Confidence values clamped to [0, 1]', () => {
  const raw = {
    intro: "Test",
    bullish: "Bull",
    bearish: "Bear",
    neutral: "Neutral",
    confidence: {
      bullish: 1.5,   // > 1, should be clamped
      bearish: -0.3,  // < 0, should be clamped
      neutral: 0.45   // Valid
    }
  };

  const result = validateAnalysisV2(raw, { ticker: 'AAPL', sources: [], parseStatus: 'ok' });

  assert.equal(result.meta.confidence.bullish, 1.0);  // Clamped to 1.0
  assert.equal(result.meta.confidence.bearish, 0.0);  // Clamped to 0.0
  assert.equal(result.meta.confidence.neutral, 0.45); // Unchanged
});

// ==================== Test 6: Confidence Rounded to 2 Decimals ====================
test('Test 6: Confidence values rounded to 2 decimals', () => {
  const raw = {
    intro: "Test",
    bullish: "Bull",
    bearish: "Bear",
    neutral: "Neutral",
    confidence: {
      bullish: 0.7777,
      bearish: 0.3333,
      neutral: 0.5555
    }
  };

  const result = validateAnalysisV2(raw, { ticker: 'AAPL', sources: [], parseStatus: 'ok' });

  assert.equal(result.meta.confidence.bullish, 0.78);
  assert.equal(result.meta.confidence.bearish, 0.33);
  assert.equal(result.meta.confidence.neutral, 0.56);
});

// ==================== Test 7: Parse Legacy Text Format ====================
test('Test 7: Parse from legacy text format', () => {
  const legacyText = `NVIDIA rose 3.2% today on strong AI chip demand.

BULLISH: Strong demand indicates growth.

BEARISH: Valuation concerns at all-time highs.

NEUTRAL: Market may consolidate near earnings.`;

  const parsed = parseFromLegacyText(legacyText);

  assert.ok(parsed.intro.includes('NVIDIA'));
  assert.ok(parsed.bullish.includes('Strong demand'));
  assert.ok(parsed.bearish.includes('Valuation concerns'));
  assert.ok(parsed.neutral.includes('Market may consolidate'));
});

// ==================== Test 8: Parse Legacy with Data Sources Footer ====================
test('Test 8: Parse legacy text with data sources footer', () => {
  const legacyText = `NVIDIA rose 3.2% today.

BULLISH: Strong demand.

BEARISH: Valuation concerns.

NEUTRAL: Wait and see.

—
Data sources:
• Alpaca (price @ 14:32 UTC)
• Yahoo Finance (options @ 14:30 UTC)`;

  const parsed = parseFromLegacyText(legacyText);

  // Should extract sections without footer
  assert.ok(parsed.intro.includes('NVIDIA'));
  assert.equal(parsed.bullish, 'Strong demand.');
  assert.equal(parsed.bearish, 'Valuation concerns.');
  assert.equal(parsed.neutral, 'Wait and see.');
});

// ==================== Test 9: Build Legacy Text from V2 ====================
test('Test 9: Build legacy text from analysis_v2', () => {
  const analysisV2 = {
    intro: "Test intro.",
    bullish: "Bullish view.",
    bearish: "Bearish view.",
    neutral: "Neutral view.",
    sources: [],
    meta: {
      ticker: 'AAPL',
      generated_at: new Date().toISOString(),
      confidence: { bullish: 0.7, bearish: 0.4, neutral: 0.3 },
      parse_status: 'ok'
    }
  };

  const dataSources = [
    { source: 'Alpaca', type: 'price', timestamp: new Date() }
  ];

  const legacyText = buildLegacyText(analysisV2, dataSources);

  assert.ok(legacyText.includes('Test intro.'));
  assert.ok(legacyText.includes('BULLISH: Bullish view.'));
  assert.ok(legacyText.includes('BEARISH: Bearish view.'));
  assert.ok(legacyText.includes('NEUTRAL: Neutral view.'));
  assert.ok(legacyText.includes('Data sources:'));
  assert.ok(legacyText.includes('Alpaca'));
});

// ==================== Test 10: Whitespace Collapsing ====================
test('Test 10: Whitespace collapsed and trimmed', () => {
  const raw = {
    intro: "  Test   with    extra    spaces  ",
    bullish: "\n\n  Bullish\nwith\nnewlines  \n\n",
    bearish: "Bear",
    neutral: "Neutral"
  };

  const result = validateAnalysisV2(raw, { ticker: 'AAPL', sources: [], parseStatus: 'ok' });

  assert.equal(result.intro, 'Test with extra spaces');
  assert.equal(result.bullish, 'Bullish with newlines');
});

// ==================== Test 11: Invalid Source Objects Filtered ====================
test('Test 11: Invalid source objects filtered out', () => {
  const sources = [
    { type: 'price', provider: 'Alpaca', timestamp: new Date().toISOString(), status: 'ok' },
    null,
    { type: 'invalid_type', provider: 'Unknown' },
    { provider: 'Missing type' },
    { type: 'news', provider: 'Finnhub', timestamp: new Date().toISOString(), status: 'ok' }
  ];

  const result = validateAnalysisV2({ intro: "Test" }, { ticker: 'SPY', sources, parseStatus: 'ok' });

  // Should have 2 valid sources (first and last)
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].type, 'price');
  assert.equal(result.sources[1].type, 'news');
});

// ==================== Test 12: Length Capping ====================
test('Test 12: Text length capped at max', () => {
  const longText = 'A'.repeat(5000);
  
  const raw = {
    intro: longText,
    bullish: 'B'.repeat(2000),
    bearish: "Bear",
    neutral: "Neutral"
  };

  const result = validateAnalysisV2(raw, { ticker: 'AAPL', sources: [], parseStatus: 'ok' });

  // Intro capped at 2000
  assert.equal(result.intro.length, 2000);
  
  // Bullish capped at 1000
  assert.equal(result.bullish.length, 1000);
});

// ==================== Test 13: Missing Confidence Uses Fallback ====================
test('Test 13: Missing confidence object uses section-based fallback', () => {
  const raw = {
    intro: "Intro",
    bullish: "Bull",
    bearish: null,  // Missing section
    neutral: "Neutral"
    // No confidence object provided
  };

  const result = validateAnalysisV2(raw, { ticker: 'AAPL', sources: [], parseStatus: 'ok' });

  // Fallback: present sections → 0.6, null sections → 0.0
  assert.equal(result.meta.confidence.bullish, 0.6);
  assert.equal(result.meta.confidence.bearish, 0.0);
  assert.equal(result.meta.confidence.neutral, 0.6);
});

// ==================== Test 14: Generated Timestamp Present ====================
test('Test 14: Generated timestamp always present', () => {
  const result = validateAnalysisV2({ intro: "Test" }, { 
    ticker: 'AAPL', 
    sources: [], 
    parseStatus: 'ok' 
  });

  assert.ok(result.meta.generated_at);
  
  // Should be valid ISO8601
  const date = new Date(result.meta.generated_at);
  assert.ok(!isNaN(date.getTime()));
});

// ==================== Test 15: Parse Status Preserved ====================
test('Test 15: Parse status preserved in meta', () => {
  const statuses = ['ok', 'coerced', 'fallback_legacy'];
  
  statuses.forEach(status => {
    const result = validateAnalysisV2({ intro: "Test" }, { 
      ticker: 'AAPL', 
      sources: [], 
      parseStatus: status
    });
    
    assert.equal(result.meta.parse_status, status);
  });
});

// ==================== Results Summary ====================
console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passedTests} passed, ${failedTests} failed`);
console.log('='.repeat(50));

if (failedTests > 0) {
  process.exit(1);
}

