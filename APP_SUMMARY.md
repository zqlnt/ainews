# AI News Stock Analysis API - Complete Summary

## What The App Does

**AI News Stock Analysis API** is a production-ready Node.js Express API that provides institutional-grade stock market analysis powered by Claude AI. It combines real-time news, live price data, and professional options analytics to deliver intelligent, data-driven market insights.

**Tagline:** *"Text a quant. Get institutional-grade options analysis in seconds."*

### Core Capabilities

1. **AI-Powered Analysis** - Uses Claude Sonnet 4 to analyze stocks with multiple perspectives (bullish, bearish, neutral)
2. **Real-Time Data Integration** - Fetches live news, prices, and options data from multiple professional sources
3. **14 Advanced Quant Metrics** - Calculates institutional-grade options metrics like Dealer Gamma, Skew, IV Term Structure, and more
4. **Smart Context Awareness** - Automatically extracts tickers from queries and provides follow-up conversation support
5. **Investment Advice Guardrails** - Never recommends buy/sell/hold, only provides data-driven analysis

---

## Example API Responses

### Example 1: Basic Stock Analysis

**Request:**
```bash
POST /analyze
{
  "query": "Why did AAPL move today?"
}
```

**Response:**
```json
{
  "success": true,
  "schema_version": "2.0",
  "analysis": "Apple shares are trading at $284.74, up 2.3% from yesterday's close. The options market shows dealer gamma of $86.8B (long), with skew at -11.5 percentage points indicating elevated put demand. ATM implied volatility sits at 22.7%, suggesting moderate volatility expectations.\n\nBULLISH: Strong dealer gamma position provides downside support, and the stock is trading above key technical levels.\n\nBEARISH: Elevated put skew suggests institutional hedging activity, which could indicate underlying concerns.\n\nNEUTRAL: Current price action appears balanced between technical support and volatility expectations.",
  "analysis_v2": {
    "intro": "Apple shares are trading at $284.74, up 2.3% from yesterday's close. The options market shows dealer gamma of $86.8B (long), with skew at -11.5 percentage points indicating elevated put demand.",
    "bullish": "Strong dealer gamma position provides downside support, and the stock is trading above key technical levels.",
    "bearish": "Elevated put skew suggests institutional hedging activity, which could indicate underlying concerns.",
    "neutral": "Current price action appears balanced between technical support and volatility expectations.",
    "sources": [
      {
        "type": "price",
        "provider": "Alpaca",
        "timestamp": "2025-11-22T20:00:00Z",
        "status": "ok",
        "freshness_seconds": 13
      },
      {
        "type": "options",
        "provider": "Polygon.io",
        "timestamp": "2025-11-22T19:45:00Z",
        "status": "ok",
        "freshness_seconds": 900
      },
      {
        "type": "news",
        "provider": "Finnhub",
        "timestamp": "2025-11-22T20:00:00Z",
        "status": "ok",
        "freshness_seconds": 0
      }
    ],
    "meta": {
      "ticker": "AAPL",
      "generated_at": "2025-11-22T20:00:29.779Z",
      "confidence": {
        "bullish": 0.4,
        "bearish": 0.4,
        "neutral": 0.6
      },
      "parse_status": "ok"
    }
  },
  "usage": {
    "input_tokens": 1098,
    "output_tokens": 436
  }
}
```

### Example 2: Options-Specific Query

**Request:**
```bash
POST /analyze
{
  "query": "What's the dealer gamma position for SPY?"
}
```

**Response:**
```json
{
  "success": true,
  "schema_version": "2.0",
  "analysis": "SPY's dealer gamma position is currently -$1.7B (short), indicating dealers are net short gamma. This creates a dynamic where large moves can accelerate as dealers hedge by buying or selling shares. The skew is 5.4 percentage points, showing elevated put demand relative to calls.\n\nBULLISH: Short gamma position means any upward momentum could accelerate as dealers buy to hedge.\n\nBEARISH: Short gamma also means downside moves could accelerate, and elevated skew suggests institutional hedging.\n\nNEUTRAL: Current positioning reflects normal market structure with balanced risk on both sides.",
  "analysis_v2": {
    "intro": "SPY's dealer gamma position is currently -$1.7B (short), indicating dealers are net short gamma. This creates a dynamic where large moves can accelerate as dealers hedge.",
    "bullish": "Short gamma position means any upward momentum could accelerate as dealers buy to hedge.",
    "bearish": "Short gamma also means downside moves could accelerate, and elevated skew suggests institutional hedging.",
    "neutral": "Current positioning reflects normal market structure with balanced risk on both sides.",
    "sources": [
      {
        "type": "options",
        "provider": "Polygon.io",
        "timestamp": "2025-11-22T19:45:00Z",
        "status": "ok",
        "freshness_seconds": 900
      }
    ],
    "meta": {
      "ticker": "SPY",
      "generated_at": "2025-11-22T20:00:29.779Z",
      "confidence": {
        "bullish": 0.3,
        "bearish": 0.3,
        "neutral": 0.7
      },
      "parse_status": "ok"
    }
  },
  "usage": {
    "input_tokens": 856,
    "output_tokens": 312
  }
}
```

### Example 3: News Feed Response

**Request:**
```bash
GET /newsfeed/blocks?topic=market&limit=12&sentiment=bullish
```

**Response:**
```json
{
  "generated_at": "2025-11-22T20:00:00Z",
  "status": "ok",
  "freshness_seconds": 0,
  "hero": {
    "title": "Apple beats earnings expectations, raises guidance",
    "source": "Reuters",
    "url": "https://reuters.com/...",
    "image": "/img?src=https://...",
    "tickers": ["AAPL"],
    "published_at": "2025-11-22T19:55:00Z",
    "age": "5m",
    "sentiment": "bullish",
    "sentiment_source": "heuristic",
    "sentiment_version": "news-v1"
  },
  "tiles": [
    {
      "title": "NVIDIA announces record data center revenue",
      "source": "Bloomberg",
      "tickers": ["NVDA"],
      "sentiment": "bullish"
    },
    {
      "title": "Fed signals potential rate cuts ahead",
      "source": "WSJ",
      "tickers": [],
      "sentiment": "bullish"
    }
  ],
  "latest": [
    // ... 9 more items
  ]
}
```

---

## What Questions Can Be Answered?

### ✅ Supported Query Types

**Price Movement Analysis:**
- "Why did AAPL move today?"
- "What's driving TSLA's decline?"
- "Explain NVDA's rally"

**Options Flow & Sentiment:**
- "What's the options sentiment on SPY?"
- "Is there unusual options activity in TSLA?"
- "What's the dealer gamma position for NVDA?"

**Market Structure:**
- "What's the implied volatility for AAPL?"
- "Is there skew in MSFT options?"
- "What move is the market pricing in for earnings?"

**Risk Assessment:**
- "What's the expected move for AMZN?"
- "Is put buying elevated in the market?"
- "What's the volatility environment like?"

**General Market Questions:**
- "What's moving in tech today?"
- "Summarize the market action"
- "What are the key risks right now?"

### ❌ NOT Answered (Investment Advice)
- "Should I buy AAPL?"
- "What's the best stock to invest in?"
- "Tell me what to do with my portfolio"

---

## Database Contents & Capabilities

### Current Database Status

**Metrics History Table:**
- **Total Records:** 238 snapshots
- **Unique Tickers:** 12 (AAPL, AMD, AMZN, GLD, GOOGL, META, MSFT, NVDA, QQQ, SPY, TEST, TSLA)
- **Date Range:** October 6, 2025 to November 22, 2025 (48 days)
- **Data Freshness:**
  - Fresh data: 144 records (60%)
  - Backfilled data: 94 records (40%)

**Conversations Table:**
- **Total Conversations:** 0 (ready for use)

### What The Database Adds

#### 1. **Historical Pattern Analysis** 🎯

The database enables the AI to analyze trends and patterns over time:

**Example Enhanced Response:**
```
"Apple's dealer gamma is currently $86.8B (long), which is 15% above the 30-day average of $75.2B. 
The trend shows gamma has been increasing 2.3% per day over the past 2 weeks, indicating building 
institutional support. This positions AAPL in the top quartile historically (78th percentile), 
suggesting unusually strong options positioning."
```

**What This Adds:**
- **Trend Detection:** Identifies if metrics are increasing, decreasing, or stable
- **Percentile Analysis:** Shows if current values are historically high/low
- **Statistical Significance:** Z-scores indicate if values are extreme
- **Regime Detection:** Classifies volatility environments (high/normal/low)
- **Correlation Analysis:** Identifies relationships between metrics (e.g., gamma vs IV)

**Requirements:**
- Needs ≥5 historical samples per metric
- Currently available for: AAPL, MSFT, NVDA, QQQ, SPY, TSLA (6 tickers)

#### 2. **Conversation Memory** 💬

Enables follow-up questions with context:

**Example Flow:**
```bash
# First query
POST /analyze
{
  "query": "Analyze AAPL",
  "conversation_id": "user-session-123"
}
# Response includes full AAPL analysis

# Follow-up (remembers AAPL context)
POST /analyze
{
  "query": "What about the gamma?",
  "conversation_id": "user-session-123"
}
# Response automatically uses AAPL from conversation history
```

**What This Adds:**
- **Context Preservation:** Remembers the last ticker discussed
- **Natural Conversations:** Users can ask follow-ups without repeating ticker
- **Session Management:** Auto-expires after 30 minutes
- **Multi-Turn Analysis:** Enables deeper dives into specific stocks

#### 3. **Historical Metrics API** 📊

Query historical data directly:

**Endpoint:**
```bash
GET /history/AAPL?days=30
```

**Response:**
```json
{
  "ticker": "AAPL",
  "days_requested": 30,
  "snapshots": 25,
  "data": [
    {
      "date": "2025-11-22",
      "spot_price": 284.74,
      "dealer_gamma_value": 86.83,
      "dealer_gamma_direction": "long",
      "skew_value": -11.51,
      "atm_iv_value": 22.7,
      "put_call_volume_ratio": 1.23,
      "implied_move_pct": 2.7,
      "max_pain": 285.00,
      "data_freshness": "fresh",
      "recorded_at": "2025-11-22T20:00:29.779Z"
    }
    // ... 24 more days
  ]
}
```

**Use Cases:**
- Build custom analytics dashboards
- Chart metrics over time
- Track volatility regime changes
- Analyze options positioning trends

#### 4. **Automated Daily Logging** 🤖

**How It Works:**
- Every successful `/analyze` request automatically logs metrics to database
- GitHub Actions workflow runs daily to log metrics for popular tickers
- One snapshot per ticker per day (upsert logic prevents duplicates)

**Current Coverage:**
- 6 tickers with complete historical data (≥5 samples for all metrics)
- 48 days of data (Oct 6 - Nov 22, 2025)
- Mix of fresh (60%) and backfilled (40%) data

---

## Technical Architecture

### Data Sources

1. **Claude AI (Anthropic)** - Analysis engine
2. **Finnhub** - Real-time stock news (last 24 hours)
3. **Alpaca Markets** - Live price data
4. **Polygon.io** - Professional options data with Greeks, IV, Open Interest
5. **Supabase** - PostgreSQL database for historical data and conversations

### 14 Quant Metrics Calculated

1. **Dealer Gamma (0-30d)** - Net gamma exposure of market makers
2. **Skew (±10% OTM)** - Put/call IV differential
3. **ATM IV** - At-the-money implied volatility
4. **Put/Call Volume Ratio** - Sentiment indicator
5. **Implied Move** - Expected move from ATM straddle
6. **Max Pain** - Strike with most open interest
7. **Gamma Walls** - Strikes with concentrated gamma
8. **IV Term Structure** - Front/back month IV comparison
9. **Zero Gamma Level** - Strike where net gamma = 0
10. **Total Delta** - Net delta exposure
11. **Total Vega** - Net vega exposure
12. **Vanna** - Sensitivity of delta to volatility
13. **Put/Call OI Ratio** - Open interest sentiment
14. **Multiple Expected Moves** - Moves for different expirations

### Response Format

**Dual Schema Support:**
- **Legacy Format:** Plain text in `analysis` field (backward compatible)
- **Structured Format:** JSON in `analysis_v2` field (new)

**Structured Format Includes:**
- `intro` - 2-4 sentence overview
- `bullish` - Bullish perspective (or null)
- `bearish` - Bearish perspective (or null)
- `neutral` - Neutral perspective (or null)
- `sources` - Data source transparency
- `meta` - Confidence scores, ticker, timestamps
- `usage` - Token usage for cost tracking

---

## Key Features

### Smart Features

- **Symbol Extraction** - Automatically detects tickers from queries
- **Investment Advice Guardrails** - Never recommends buy/sell/hold
- **Graceful Degradation** - Never returns 500 errors, always provides response
- **Smart Caching** - 4-hour fresh cache, 24-hour stale cache for options data
- **News Sentiment Classification** - Automatic bullish/neutral/bearish classification
- **Historical Pattern Recognition** - Trend analysis when ≥5 samples available

### Production Ready

- **CORS Enabled** - For iOS app integration
- **Error Handling** - Comprehensive error handling with fallbacks
- **Rate Limiting** - Built-in protection for external APIs
- **Data Freshness Tracking** - Transparent about data age
- **Backward Compatible** - All existing functionality preserved

---

## Database Enhancement Summary

### Without Database
- ✅ Real-time analysis works perfectly
- ✅ News, price, and options data available
- ✅ AI analysis with multiple perspectives
- ❌ No historical context or trends
- ❌ No conversation memory
- ❌ No follow-up question support

### With Database
- ✅ **Everything above, PLUS:**
- ✅ Historical pattern analysis (trends, percentiles, correlations)
- ✅ Conversation memory for natural follow-ups
- ✅ Historical metrics API for custom analytics
- ✅ Automated daily logging for continuous data collection
- ✅ Enhanced AI responses with statistical context

**The database transforms the API from a real-time analysis tool into an intelligent system that learns from history and provides context-aware insights.**

---

## Example: Enhanced Response with Database

**Without Database:**
```
"Apple's dealer gamma is $86.8B (long), with skew at -11.5 pp and ATM IV at 22.7%."
```

**With Database (Historical Context):**
```
"Apple's dealer gamma is $86.8B (long), which is 15% above the 30-day average of $75.2B. 
The trend shows gamma has been increasing 2.3% per day over the past 2 weeks (robust method), 
placing AAPL in the top quartile historically (78th percentile, z-score: 1.8 - unusual). 
Skew at -11.5 pp is elevated compared to the -8.2 pp average, indicating heightened put demand. 
ATM IV of 22.7% is in a normal volatility regime, down from the 25.1% average but within 
1 standard deviation. Historical correlation analysis shows a moderate positive relationship 
between gamma and IV (0.65, 18 matched samples)."
```

**The database enables the AI to provide institutional-grade analysis with statistical rigor and historical context.**

---

**Generated:** November 22, 2025  
**Database Status:** 238 records, 12 tickers, 48 days of history  
**Ready for Production:** ✅ Yes


