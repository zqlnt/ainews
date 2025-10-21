/**
 * Sentiment classification for news items using keyword heuristics
 */

const VERSION = 'news-v1';

// Bullish keywords (score +2 each) - sorted by length (longest first for proper matching)
const BULLISH_KEYWORDS = [
  'all-time high',
  'margin expansion',
  'raises guidance',
  'raised guidance',
  'raising guidance',
  'revenue growth',
  'revenue surge',
  'strong demand',
  'strong earnings',
  'strong sales',
  'initiates buy',
  'initiate buy',
  'raises target',
  'raised target',
  'raise target',
  'profit rises',
  'profit rose',
  'new high',
  'outperforms',
  'outperform',
  'outperformed',
  'surpasses',
  'surpassed',
  'expansion',
  'expanding',
  'upgraded',
  'upgrades',
  'upgrade',
  'beating',
  'expands',
  'surpass',
  'record',
  'beats',
  'beat',
  'wins',
  'won'
];

// Bearish keywords (score -2 each) - sorted by length (longest first)
const BEARISH_KEYWORDS = [
  'sec investigation',
  'weakening demand',
  'cuts guidance',
  'cut guidance',
  'cutting guidance',
  'loss widens',
  'loss widened',
  'weak demand',
  'debt concerns',
  'debt worry',
  'disappointing',
  'disappointed',
  'disappoints',
  'downgrades',
  'downgraded',
  'downgrade',
  'investigation',
  'declined',
  'declines',
  'decline',
  'delayed',
  'delays',
  'delay',
  'recalls',
  'recall',
  'plunged',
  'plunges',
  'plunge',
  'slumped',
  'slumps',
  'slump',
  'warned',
  'warns',
  'warning',
  'lawsuits',
  'lawsuit',
  'layoffs',
  'layoff',
  'missed',
  'misses',
  'miss',
  'probe'
];

// Negation patterns that flip bearish to neutral/bullish
// Handle both word orders: "lawsuit dismissed" and "dismisses lawsuit"
const NEGATION_PATTERNS = [
  { pattern: /(dismiss|dismisses|dismissed|drop|dropped|settle|settled)[\s\w]*lawsuit|lawsuit[\s\w]*(dismiss|dismisses|dismissed|drop|dropped|settle|settled)/i, flip: +4 },
  { pattern: /(drop|dropped|dismiss|dismisses|dismissed|close|closed)[\s\w]*probe|probe[\s\w]*(drop|dropped|dismiss|dismisses|dismissed|close|closed)/i, flip: +4 },
  { pattern: /(reverse|reversed|reverses|withdraw|withdrawn)[\s\w]*downgrade|downgrade[\s\w]*(reverse|reversed|reverses|withdraw|withdrawn)/i, flip: +4 },
  { pattern: /(close|closed|dismiss|dismisses|dismissed|drop|dropped)[\s\w]*investigation|investigation[\s\w]*(close|closed|dismiss|dismisses|dismissed|drop|dropped)/i, flip: +4 },
  { pattern: /(avoid|avoided|prevent|prevented)[\s\w]*recall|recall[\s\w]*(avoid|avoided|prevent|prevented)/i, flip: +4 }
];

// Strong guidance signals (prioritized over beats/misses)
// Allow for words/hyphens between verb and "guidance" (e.g., "cuts full-year guidance")
const GUIDANCE_PATTERNS = [
  { pattern: /(raise|raises|raised|raising)[\s\-\w]*guidance/i, score: +3 },
  { pattern: /(cut|cuts|cutting)[\s\-\w]*guidance/i, score: -3 }
];

/**
 * Classify sentiment of a news item
 * @param {Object} item
 * @param {string} item.title - Headline text
 * @param {string} [item.summary] - Optional summary/description
 * @param {string} [item.source] - Optional source
 * @returns {Object} Classification result
 */
export function classifySentiment(item) {
  const { title = '', summary = '' } = item;
  let text = (title + ' ' + summary).toLowerCase();
  
  let score = 0;
  const reasons = [];
  
  // Check for negation patterns FIRST and remove them to prevent double-counting
  for (const { pattern, flip } of NEGATION_PATTERNS) {
    if (pattern.test(text)) {
      score += flip;
      reasons.push('negation');
      // Remove the negated phrase from text to prevent it from matching bearish keywords
      text = text.replace(pattern, ' ');
    }
  }
  
  // Check for guidance patterns (highest priority)
  for (const { pattern, score: guidanceScore } of GUIDANCE_PATTERNS) {
    if (pattern.test(text)) {
      score += guidanceScore;
      reasons.push(guidanceScore > 0 ? 'raises guidance' : 'cuts guidance');
      // Remove guidance pattern to avoid double-counting
      text = text.replace(pattern, ' ');
    }
  }
  
  // Count bullish keywords (check longest first to avoid partial matches)
  for (const keyword of BULLISH_KEYWORDS) {
    // Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+').replace(/-/g, '\\-')}\\b`, 'i');
    if (regex.test(text)) {
      score += 2;
      reasons.push(`+${keyword}`);
      // Remove matched keyword to avoid double-counting
      text = text.replace(regex, ' ');
    }
  }
  
  // Count bearish keywords (check longest first)
  for (const keyword of BEARISH_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+').replace(/-/g, '\\-')}\\b`, 'i');
    if (regex.test(text)) {
      score -= 2;
      reasons.push(`-${keyword}`);
      // Remove matched keyword to avoid double-counting
      text = text.replace(regex, ' ');
    }
  }
  
  // Determine label based on score
  // Use threshold of ±1 to ensure guidance signals (±3) dominate over beats/misses (±2)
  let label = 'neutral';
  if (score >= 1) {
    label = 'bullish';
  } else if (score <= -1) {
    label = 'bearish';
  }
  
  return {
    label,
    score,
    reason: reasons.slice(0, 3).join(', ') || 'no strong signals',
    version: VERSION
  };
}

/**
 * Add sentiment to a news item
 * @param {Object} newsItem - News item object
 * @returns {Object} News item with sentiment fields added
 */
export function enrichWithSentiment(newsItem) {
  const classification = classifySentiment({
    title: newsItem.title,
    summary: newsItem.summary || ''
  });
  
  return {
    ...newsItem,
    sentiment: classification.label,
    sentiment_source: 'heuristic',
    sentiment_version: classification.version
  };
}

