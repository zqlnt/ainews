/**
 * Validation and coercion for analysis_v2 structured output
 */

/**
 * Clamp a number to [0, 1] range and round to 2 decimals
 */
const clampConfidence = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return Math.round(value * 100) / 100;
};

/**
 * Clean and validate a text section
 * Returns null if invalid, otherwise trimmed/collapsed string
 */
const cleanSection = (text, maxLength = 1000) => {
  if (!text || typeof text !== 'string') return null;
  
  // Collapse whitespace and trim
  const cleaned = text.replace(/\s+/g, ' ').trim();
  
  // Return null if empty after cleaning
  if (cleaned.length === 0) return null;
  
  // Cap length
  return cleaned.substring(0, maxLength);
};

/**
 * Validate and format ISO8601 timestamp
 */
export const validateTimestamp = (timestamp) => {
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) return null;
  const date = new Date(timestamp);
  const day = timestamp.slice(0, 10);
  if (!Number.isFinite(date.getTime()) || new Date(day).toISOString().slice(0, 10) !== day) return null;
  return date.toISOString();
};

/**
 * Validate source object
 */
const validateSource = (source) => {
  const validTypes = ['price', 'options', 'news'];
  
  if (!source || typeof source !== 'object') return null;
  
  // Must have valid type and provider
  if (!validTypes.includes(source.type)) return null;
  if (!source.provider || typeof source.provider !== 'string') return null;
  
  const type = source.type;
  const provider = source.provider;
  const timestamp = validateTimestamp(source.timestamp);
  const status = ['ok', 'stale', 'unavailable'].includes(source.status) 
    ? source.status 
    : 'unknown';
  
  // Age is unknown when the observation timestamp is absent or in the future.
  const age = timestamp ? (Date.now() - Date.parse(timestamp)) / 1000 : NaN;
  const freshness_seconds = Number.isFinite(age) && age >= 0 ? Math.round(age) : null;

  return {
    type,
    provider,
    timestamp,
    fetched_at: validateTimestamp(source.fetched_at),
    status: status === 'ok' && freshness_seconds === null ? 'unknown' : status,
    freshness_seconds
  };
};

/**
 * Validate and coerce the full analysis_v2 structure
 * 
 * @param {Object} raw - Raw output from Claude (could be malformed)
 * @param {Object} options - Additional metadata (ticker, sources, etc.)
 * @returns {Object} Validated analysis_v2 object
 */
export function validateAnalysisV2(raw, options = {}) {
  const {
    ticker = null,
    sources = [],
    parseStatus = 'ok'
  } = options;
  
  // Ensure raw is an object
  if (!raw || typeof raw !== 'object') {
    raw = {};
  }
  
  // Clean sections (null if invalid)
  const intro = cleanSection(raw.intro, 2000);
  const bullish = cleanSection(raw.bullish, 1000);
  const bearish = cleanSection(raw.bearish, 1000);
  const neutral = cleanSection(raw.neutral, 1000);
  
  // Validate sources array
  const validatedSources = Array.isArray(sources) 
    ? sources.map(validateSource).filter(s => s !== null)
    : [];
  
  // Self-reported model scores are neither defaulted nor calibrated probabilities.
  const confidence = Object.fromEntries(['bullish', 'bearish', 'neutral'].map(key =>
    [key, ({bullish, bearish, neutral})[key] ? clampConfidence(raw.confidence?.[key]) : null]));

  // Build validated analysis_v2 object
  return {
    intro,
    bullish,
    bearish,
    neutral,
    sources: validatedSources,
    meta: {
      ticker: ticker || null,
      generated_at: new Date().toISOString(),
      confidence,
      confidence_basis: 'uncalibrated_model_score',
      parse_status: parseStatus
    }
  };
}

/**
 * Parse Claude's text output into structured format
 * Attempts to extract sections from legacy text format
 * 
 * @param {string} text - Claude's text output
 * @returns {Object} Parsed structure (may be incomplete)
 */
export function parseFromLegacyText(text) {
  if (!text || typeof text !== 'string') {
    return {
      intro: null,
      bullish: null,
      bearish: null,
      neutral: null
    };
  }
  
  // Remove data sources footer if present
  const parts = text.split(/\n—\nData sources:/);
  const mainText = parts[0].trim();
  
  // Split by sentiment markers
  const bullishMatch = mainText.match(/BULLISH:\s*(.+?)(?=\n\nBEARISH:|\nBEARISH:|$)/s);
  const bearishMatch = mainText.match(/BEARISH:\s*(.+?)(?=\n\nNEUTRAL:|\nNEUTRAL:|$)/s);
  const neutralMatch = mainText.match(/NEUTRAL:\s*(.+?)(?=\n|$)/s);
  
  // Extract intro (everything before first sentiment marker)
  const introMatch = mainText.match(/^(.+?)(?=\n\nBULLISH:|\nBULLISH:|$)/s);
  const intro = introMatch ? introMatch[1].trim() : null;
  
  const bullish = bullishMatch ? bullishMatch[1].trim() : null;
  const bearish = bearishMatch ? bearishMatch[1].trim() : null;
  const neutral = neutralMatch ? neutralMatch[1].trim() : null;
  
  return {
    intro,
    bullish,
    bearish,
    neutral
  };
}

/**
 * Build legacy analysis text from analysis_v2
 * 
 * @param {Object} analysisV2 - Validated analysis_v2 object
 * @returns {string} Formatted legacy text
 */
export function buildLegacyText(analysisV2) {
  const parts = [];
  
  // Add intro (with special handling for Quant Metrics)
  if (analysisV2.intro) {
    let intro = analysisV2.intro;
    
    // If "Quant Metrics:" or "Quant (cached" appears in intro, ensure it's on its own paragraph
    const quantMatch = intro.match(/(.+?)\s+(Quant\s+Metrics(?:\s+\(cached[^)]+\))?:\s+.+)$/s);
    if (quantMatch) {
      // Split intro and quant line, join with double newline
      const mainIntro = quantMatch[1].trim();
      const quantLine = quantMatch[2].trim();
      intro = `${mainIntro}\n\n${quantLine}`;
    }
    
    parts.push(intro);
  }
  
  // Add sentiment sections
  if (analysisV2.bullish) {
    parts.push(`\nBULLISH: ${analysisV2.bullish}`);
  }
  if (analysisV2.bearish) {
    parts.push(`\nBEARISH: ${analysisV2.bearish}`);
  }
  if (analysisV2.neutral) {
    parts.push(`\nNEUTRAL: ${analysisV2.neutral}`);
  }
  
  let text = parts.join('\n');
  
  return text;
}

