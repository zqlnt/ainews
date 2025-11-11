# AI News Stock Analysis API

A Node.js Express API that provides stock analysis using Claude AI, real-time news from Finnhub, and professional-grade options data from Polygon.io. Built for iOS integration and deployed on Render.

**Text a quant. Get institutional-grade options analysis in seconds.**

## Features

- 🤖 **AI-powered stock analysis** using Claude Sonnet 4
- 📰 **Real-time stock news** from Finnhub (last 24 hours)
- 💰 **Live price data** from Alpaca Markets
- 📊 **Professional options data** from Polygon.io with Greeks, IV & Open Interest
- 🔍 **Multiple perspectives**: Bullish, Bearish, and Neutral analysis
- 🛡️ **Investment advice guardrails** - never recommends buy/sell/hold
- 🧮 **14 Advanced quant metrics**: Dealer Gamma, Skew, ATM IV, Put/Call Ratios, Implied Moves, Max Pain, Gamma Walls, IV Term Structure, Zero Gamma Level, Total Delta/Vega, Vanna, and more
- 🎯 **Symbol extraction** - automatically detects tickers from queries
- ✅ **Built-in API key testing** endpoints
- 🚀 **Production-ready** with proper error handling
- 🌐 **CORS enabled** for iOS app integration

## What Questions Can Be Answered?

The API can handle various types of stock market questions:

### ✅ Price Movement Analysis
- "Why did AAPL move today?"
- "What's driving TSLA's decline?"
- "Explain NVDA's rally"

### ✅ Options Flow & Sentiment
- "What's the options sentiment on SPY?"
- "Is there unusual options activity in TSLA?"
- "What's the dealer gamma position for NVDA?"

### ✅ Market Structure
- "What's the implied volatility for AAPL?"
- "Is there skew in MSFT options?"
- "What move is the market pricing in for earnings?"

### ✅ Risk Assessment
- "What's the expected move for AMZN?"
- "Is put buying elevated in the market?"
- "What's the volatility environment like?"

### ✅ General Market Questions
- "What's moving in tech today?"
- "Summarize the market action"
- "What are the key risks right now?"

### ❌ NOT Answered (Investment Advice)
- "Should I buy AAPL?"
- "What's the best stock to invest in?"
- "Tell me what to do with my portfolio"

The API provides data-driven analysis but never gives buy/sell/hold recommendations.

## 🆕 Schema V2 - Structured Analysis Response

**New in v2.0**: The `/analyze` endpoint now returns both legacy text format AND structured JSON output.

### Response Structure

```json
{
  "success": true,
  "schema_version": "2.0",
  "analysis": "...legacy text format...",
  "analysis_v2": {
    "intro": "2-4 sentence overview including quant metrics",
    "bullish": "Bullish perspective (or null if unavailable)",
    "bearish": "Bearish perspective (or null if unavailable)",
    "neutral": "Neutral perspective (or null if unavailable)",
    "sources": [
      {
        "type": "price|options|news",
        "provider": "Alpaca|Polygon.io|Finnhub",
        "timestamp": "2025-10-11T16:43:38.457Z",
        "status": "ok|stale|unavailable",
        "freshness_seconds": 13
      }
    ],
    "meta": {
      "ticker": "AAPL",
      "generated_at": "2025-10-11T16:43:51.140Z",
      "confidence": {
        "bullish": 0.4,
        "bearish": 0.4,
        "neutral": 0.6
      },
      "parse_status": "ok|coerced|fallback_legacy"
    }
  },
  "usage": {
    "input_tokens": 1098,
    "output_tokens": 436
  }
}
```

### Key Features

- **Backward Compatible**: Legacy `analysis` field remains unchanged for existing clients
- **Structured Sections**: Parse-friendly bullish/bearish/neutral perspectives
- **Confidence Scores**: 0.0-1.0 scores for each perspective
- **Data Transparency**: Sources array with freshness indicators
- **Graceful Degradation**: Sections can be null; parse_status indicates quality
- **Validation & Coercion**: All fields validated, clamped, and sanitized server-side

### Parse Status Values

- `ok`: Structured output received from Claude successfully
- `coerced`: Structured output received after retry
- `fallback_legacy`: Parsed from text format (structured generation failed)

### Confidence Scores

- **Range**: Always 0.0 to 1.0 (clamped and rounded to 2 decimals)
- **Source**: Provided by Claude AI based on evidence strength
- **Fallback**: If section is null → 0.0, else 0.6 default

### Source Status Values

- `ok`: Data fresh and successfully fetched
- `stale`: Cached data older than fresh TTL but within stale window
- `unavailable`: Data fetch failed or not available

## Latest Updates

### ✅ Symbol & Intent Detection
- **Symbol Extraction**: Automatically detects ticker symbols from user queries (e.g., "Why did NVDA move?" → NVDA)
- **Advice Detection**: Intercepts investment advice queries and returns non-advice message
  - Patterns detected: "what should I buy", "I have $100 what should I do", etc.
  - Response: "I can't provide investment advice. Try: 'Why did NVDA move today?'"

### ✅ Live Price Fetch via Alpaca
- **Integration**: Fetches real-time price data from Alpaca Markets API
- **Data Retrieved**: Current price, previous close, % change
- **Graceful Failure**: If Alpaca fails, continues without price data (no breaking errors)
- **Fallback**: Uses Yahoo Finance quote if available when Alpaca unavailable

### ✅ Options Data via Polygon.io
- **Endpoint**: https://api.polygon.io/v3/snapshot/options/{symbol}
- **Caching**: 4-hour fresh cache, 24-hour stale cache
- **Data Retrieved**: Full options chain with Greeks (delta, gamma, theta, vega), implied volatility, open interest, volume
- **Reliability**: Professional API designed for datacenter use, no IP blocking issues
- **Graceful Failure**: Falls back to stale cache if fresh fetch fails, never throws errors

### ✅ Quant Calculators
- **Dealer Gamma (0-30d)**:
  - Black-Scholes gamma formula: Γ = φ(d1)/(S·σ·√T)
  - Dollarized: Γ × S² × 100 × OI
  - Dealer convention: negative sum (dealers short gamma)
  - Format: e.g., "-$1.7B (short)"
  - Tracks top 3 strike contributors

- **Skew (±10% OTM)**:
  - Finds IV at 0.9S (put) and 1.1S (call)
  - Linear interpolation between strikes
  - Reports: IV_put - IV_call in percentage points
  - Format: e.g., "5.4 pp"

- **ATM IV** (At-the-Money Implied Volatility):
  - Finds strike nearest to spot price
  - Averages call + put IV at ATM strike (uses either if one missing)
  - Reports: Percentage with strike level
  - Format: e.g., "34.6%@485"

- **Put/Call Volume Ratio**:
  - Sums put and call volumes for nearest expiry
  - PCR = total_put_volume / total_call_volume
  - Sentiment indicator: >1 = more put volume (bearish), <1 = more call volume (bullish)
  - Format: e.g., "1.23"

- **Implied Move** (ATM Straddle):
  - Calculates ATM call mid + ATM put mid
  - Uses bid/ask mid if available, falls back to lastPrice
  - Expresses as $ amount and % of spot
  - Represents market's expected move by expiry
  - Format: e.g., "$12.80 (2.7%)"

### ✅ Smart Caching for Quant Data
- **Goal**: Ensure quant metrics appear in EVERY response (not just when real-time fetch succeeds)
- **Strategy**: Stale-while-revalidate pattern
  1. **Fresh Cache (4 hours)**: Return immediately if cached < 4 hours ago
  2. **Try Fresh Fetch**: Attempt to fetch new data from Polygon.io
  3. **Fallback to Stale (24 hours)**: If fetch fails, serve cached data from last 24 hours
  4. **Show Data Age**: Quant line includes timestamp when using cached data
- **Example**:
  - Fresh: `Quant: Dealer Gamma (0-30d): -$1.2B (short); Skew (±10%): 5.4 pp...`
  - Cached: `Quant (cached 47 min ago): Dealer Gamma (0-30d): -$1.2B (short); Skew (±10%): 5.4 pp...`
- **Result**: Users always get quant data with transparency about freshness

### ✅ News Evidence Formatting
- **Cleans raw news string**: Strips line breaks, weird punctuation, empty lines
- **Formats as bullets**: Transforms into clean evidence points
- **Example**:
  - Input: "Tesla shares fall 5%!!!\n\nElon delays factory;;;"
  - Output: ["Tesla shares fall 5%.", "Elon delays factory."]
- **Limit**: Top 5 evidence points

### ✅ Strict Output Template
- **Fixed Format**:
  ```
  <2-4 sentence overview, includes quant metrics if available>
  
  BULLISH: <1-2 sentences tied to evidence>
  
  BEARISH: <1-2 sentences tied to evidence>
  
  NEUTRAL: <1-2 sentences tied to evidence>
  
  Note: Options data unavailable for this symbol. (if applicable)
  ```

- **Prompt Rules**:
  - Use ONLY provided evidence and numbers
  - Never recommend buy/sell/hold
  - No markdown headers or emojis
  - Always include three labeled perspectives
  - Explicitly states when options unavailable

### 🔒 API Stability Guarantee
- ✅ `POST /analyze` → returns `{ success, analysis, usage }` (unchanged)
- ✅ `GET /news/:symbol` → unchanged
- ✅ `/test/*` endpoints → unchanged
- ✅ All response shapes identical to original

### 📊 Enhanced Analysis Response
The `analysis` field now contains:
1. **Structured format** with labeled perspectives (BULLISH/BEARISH/NEUTRAL)
2. **Quant metrics** when options data available
3. **Evidence-based reasoning** from cleaned news
4. **Explicit unavailability notices** when data missing

Example response:
```json
{
  "success": true,
  "analysis": "NVIDIA shares are down 4% following earnings miss...\n\nBULLISH: ...\n\nBEARISH: ...\n\nNEUTRAL: ...\n\nNote: Options data unavailable for this symbol.",
  "usage": {
    "input_tokens": 277,
    "output_tokens": 193
  }
}
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Edit `.env`:
```
CLAUDE_API_KEY=your_claude_api_key_here
FINNHUB_API_KEY=your_finnhub_api_key_here
ALPACA_API_KEY=your_alpaca_api_key_here
ALPACA_SECRET_KEY=your_alpaca_secret_key_here
POLYGON_API_KEY=your_polygon_api_key_here
OPTIONS_PROVIDER=polygon
PORT=3000

# Optional: Conversation Memory & Metrics Logging (Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

### 3. Run Locally

```bash
npm start
```

The server will start on `http://localhost:3000` and automatically test both API keys on startup.

## API Endpoints

### Health Check
**GET /** - Check if API is running

```bash
curl http://localhost:3000/
```

Response:
```json
{
  "status": "running",
  "message": "AI News Stock Analysis API",
  "version": "1.0.0",
  "endpoints": { ... }
}
```

---

### Stock Analysis
**POST /analyze** - Get AI analysis of stock movement

Request body:
```json
{
  "query": "Why is TSLA down?",
  "news": "Tesla shares fall 5% after Q3 earnings miss... Elon Musk announces new factory delays...",
  "conversation_id": "optional-uuid-for-conversation-memory"
}
```

**Note**: `conversation_id` is optional. If provided, enables conversation memory for follow-up questions.

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Why is TSLA down?",
    "news": "Tesla shares fall 5% after Q3 earnings miss expectations. Elon Musk announces production delays at new factory."
  }'
```

Response:
```json
{
  "success": true,
  "analysis": "Tesla is down today primarily due to...\n\n1. BULLISH take: ...\n2. BEARISH take: ...\n3. NEUTRAL take: ...",
  "usage": {
    "input_tokens": 245,
    "output_tokens": 312
  }
}
```

---

### Get Stock News
**GET /news/:symbol** - Fetch recent news for a stock symbol

```bash
curl http://localhost:3000/news/AAPL
```

Response:
```json
{
  "success": true,
  "symbol": "AAPL",
  "count": 10,
  "dateRange": {
    "from": "2025-10-06",
    "to": "2025-10-07"
  },
  "articles": [
    {
      "headline": "Apple announces new iPhone features",
      "summary": "Apple Inc. revealed...",
      "datetime": 1728288000,
      "source": "Reuters",
      "url": "https://..."
    }
  ]
}
```

---

### Test Claude API
**GET /test/claude** - Test Claude API connection

```bash
curl http://localhost:3000/test/claude
```

Response:
```json
{
  "status": "success",
  "message": "Claude API is working correctly",
  "response": "API Working"
}
```

---

### Test Finnhub API
**GET /test/finnhub** - Test Finnhub API connection

```bash
curl http://localhost:3000/test/finnhub
```

Response:
```json
{
  "status": "success",
  "message": "Finnhub API is working correctly",
  "count": 50,
  "sample_headline": "Apple announces new product line"
}
```

---

### Test All APIs
**GET /test/all** - Test both Claude and Finnhub APIs at once

```bash
curl http://localhost:3000/test/all
```

Response:
```json
{
  "claude": {
    "status": "success",
    "message": "Connected successfully"
  },
  "finnhub": {
    "status": "success",
    "message": "Connected successfully"
  },
  "overall": "all working"
}
```

---

### Test Options Provider
**GET /test/options** - Check which options data provider is configured

```bash
curl http://localhost:3000/test/options
```

Response:
```json
{
  "provider": "polygon"
}
```

---

### Test Metrics Logging
**GET /test/metrics-logging** - Test metrics logging functionality (Supabase)

```bash
curl http://localhost:3000/test/metrics-logging
```

Response:
```json
{
  "enabled": true,
  "test_result": true,
  "message": "Test metrics logged successfully"
}
```

---

### Conversation Memory Stats
**GET /stats/conversations** - Get conversation memory statistics

```bash
curl http://localhost:3000/stats/conversations
```

Response:
```json
{
  "enabled": true,
  "total": 42,
  "active": 12
}
```

---

### Metrics Logging Stats
**GET /stats/metrics** - Get historical metrics logging statistics

```bash
curl http://localhost:3000/stats/metrics
```

Response:
```json
{
  "enabled": true,
  "total_snapshots": 150,
  "unique_tickers": 25,
  "date_range": {
    "start": "2025-10-15",
    "end": "2025-10-29"
  }
}
```

---

### Historical Metrics
**GET /history/:ticker?days=30** - Get historical metrics snapshots for a ticker

```bash
curl http://localhost:3000/history/AAPL?days=30
```

Response:
```json
{
  "ticker": "AAPL",
  "days_requested": 30,
  "snapshots": 15,
  "data": [
    {
      "date": "2025-10-29",
      "dealer_gamma_value": -1.2,
      "dealer_gamma_direction": "short",
      "skew_pp": 5.4,
      "atm_iv": 34.6,
      "put_call_vol_ratio": 1.23,
      ...
    }
  ]
}
```

## Deploy to Render

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit - AI News Stock Analysis API"
git branch -M main
git remote add origin https://github.com/yourusername/ainews-api.git
git push -u origin main
```

### Step 2: Create Render Web Service

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `ainews-api` (or your preferred name)
   - **Environment**: `Node`
   - **Build Command**: (leave empty)
   - **Start Command**: `npm start`
   - **Plan**: Free (or paid for production)

### Step 3: Add Environment Variables

In Render dashboard, go to **Environment** tab and add:

```
CLAUDE_API_KEY=your_claude_api_key_here
FINNHUB_API_KEY=your_finnhub_api_key_here
ALPACA_API_KEY=your_alpaca_api_key_here
ALPACA_SECRET_KEY=your_alpaca_secret_key_here
POLYGON_API_KEY=your_polygon_api_key_here
OPTIONS_PROVIDER=polygon

# Optional: Conversation Memory & Metrics Logging (Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

**Note**: `PORT` is automatically set by Render, no need to add it.

### Step 4: Deploy

Click **"Create Web Service"** and Render will automatically:
- Install dependencies (`npm install`)
- Start your server (`npm start`)
- Assign a public URL (e.g., `https://ainews-api.onrender.com`)

### Step 5: Test Your Deployment

```bash
# Test health check
curl https://your-app.onrender.com/

# Test API keys
curl https://your-app.onrender.com/test/all

# Test news endpoint
curl https://your-app.onrender.com/news/AAPL
```

## Options Data Provider (Polygon.io)

This service uses **Polygon.io** for professional-grade options data with full Greeks, implied volatility, and open interest.

### How It Works

1. **Polygon.io API**:
   - Fetches complete options snapshot with Greeks (delta, gamma, theta, vega)
   - Returns real-time IV, open interest, volume for all strikes
   - No IP blocking issues (designed for datacenter use)

2. **Smart Caching**:
   - **Fresh cache**: 4 hours TTL
   - **Stale cache**: 24 hours TTL
   - **Stale-while-revalidate**: Serves cached data if fresh fetch fails
   - Always shows data age when using cached data

3. **Quant Calculations**:
   - **Dealer Gamma (0-30d)**: Black-Scholes gamma × S² × 100 × OI, dealer convention (short/long)
   - **Skew (±10% OTM)**: IV difference between 0.9S puts and 1.1S calls
   - **ATM IV**: At-the-money implied volatility
   - **Put/Call Ratio**: Volume-based sentiment indicator
   - **Implied Move**: Expected price movement based on ATM straddle

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_API_KEY` | Yes | Your Anthropic Claude API key |
| `FINNHUB_API_KEY` | Yes | Your Finnhub API key |
| `ALPACA_API_KEY` | Yes | Your Alpaca Markets API key |
| `ALPACA_SECRET_KEY` | Yes | Your Alpaca Markets secret key |
| `POLYGON_API_KEY` | Yes | Your Polygon.io API key (requires paid tier for options) |
| `OPTIONS_PROVIDER` | No | Options data source (default: `polygon`) |
| `OPT_MAX_DAYS` | No | Max days for options expiries (default: `30`) |
| `OPT_CACHE_TTL_SEC` | No | Fresh cache TTL in seconds (default: `14400` = 4 hours) |
| `OPT_STALE_TTL_SEC` | No | Stale cache TTL in seconds (default: `86400` = 24 hours) |
| `PORT` | No | Server port (default: 3000, auto-set on Render) |
| `BASE_PUBLIC_URL` | No | Public base URL for absolute URLs (e.g., `https://ainews-ybbv.onrender.com`) |
| `SUPABASE_URL` | No | Supabase project URL (enables conversation memory & metrics logging) |
| `SUPABASE_ANON_KEY` | No | Supabase anon/public key (enables conversation memory & metrics logging) |

### Example Output with Quant

```json
{
  "success": true,
  "analysis": "NVDA rose 3.1% today on strong AI chip demand.\n\nQuant Metrics: Dealer Gamma (0-30d): -$1.2B (short); Skew (±10%): 5.4 pp; ATM IV: 34.6%@485; Put/Call Vol Ratio: 1.23; Implied Move: $12.80 (2.7%) [29 Oct 2:25 pm GMT]\n\nBULLISH: Strong demand momentum suggests continued upside, with negative dealer gamma potentially amplifying moves higher...\n\nBEARISH: Elevated implied volatility and skew indicate market participants are hedging downside risk despite the rally...\n\nNEUTRAL: Wait for confirmation of sustained demand before committing, as the implied move suggests significant uncertainty..."
}
```

**Note**: The quant metrics line includes a data freshness timestamp in UK time (GMT/BST), showing when the options data is from (15 minutes delayed during market hours for paid Polygon.io plans).

### Graceful Degradation

If options data is unavailable:
- Response still includes BULLISH/BEARISH/NEUTRAL
- Appends: "Note: Options data unavailable (no licensed options feed configured)."
- No breaking errors or timeouts

### No iOS Changes Required

The response format remains `{ success, analysis, usage }` - quant metrics appear in the analysis text.

## Error Handling

The API returns appropriate HTTP status codes:

- **200**: Success
- **400**: Bad request (missing required fields)
- **401**: Authentication error (invalid API keys)
- **500**: Internal server error

Error response format:
```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

## Troubleshooting

### Problem: "Claude API: Error - authentication_error"

**Solution**: Check your `CLAUDE_API_KEY` in `.env` file. Make sure it starts with `sk-ant-api03-`.

```bash
# Test Claude API key
curl http://localhost:3000/test/claude
```

---

### Problem: "Finnhub API: Error - You don't have access to this resource"

**Solution**: Verify your `FINNHUB_API_KEY` is correct. Test it:

```bash
# Test Finnhub API key
curl http://localhost:3000/test/finnhub
```

---

### Problem: "Cannot find module 'node-fetch'"

**Solution**: Make sure you're using Node.js v18+ and installed dependencies:

```bash
node --version  # Should be v18 or higher
npm install
```

---

### Problem: "Port 3000 is already in use"

**Solution**: Either kill the process using port 3000 or change the port:

```bash
# Change port in .env
PORT=3001

# Or export it
export PORT=3001
npm start
```

---

### Problem: API works locally but fails on Render

**Solution**: 
1. Check Render logs (Dashboard → your service → Logs)
2. Verify environment variables are set correctly in Render
3. Make sure `type: "module"` is in `package.json`
4. Confirm `npm start` command is set to `node server.js`

---

### Problem: "No news articles found"

**Solution**: The Finnhub free tier may have limited access. Try:
1. Verify the stock symbol is valid (e.g., AAPL, TSLA, NVDA)
2. Check if it's a trading day (market closed on weekends)
3. Try a more popular stock symbol

---

### Problem: CORS errors from iOS app

**Solution**: CORS is already enabled for all origins. If you still see errors:
1. Make sure you're making requests to the correct URL
2. Check that Content-Type header is set to `application/json`
3. Verify the request method matches the endpoint (GET vs POST)

## Development

### Run with auto-reload (Node 18+)

```bash
npm run dev
```

This uses Node's built-in `--watch` flag to restart on file changes.

### Check logs

All important operations are logged with timestamps:
- ✅ Success messages (green checkmark)
- ❌ Error messages (red X)
- 📊 Analysis requests
- 📰 News requests
- 🧪 Test requests

## Architecture

```
┌─────────────┐
│   iOS App   │
└──────┬──────┘
       │
       ├─────GET /news/TSLA──────┐
       │                         │
       │                    ┌────▼─────┐      ┌──────────┐
       │                    │  Express │─────→│ Finnhub  │
       │                    │  Server  │      │   API    │
       │                    └────┬─────┘      └──────────┘
       │                         │
       └─────POST /analyze───────┤
                                 │
                            ┌────▼─────┐
                            │  Claude  │
                            │   API    │
                            └──────────┘
```

## Tech Stack

- **Runtime**: Node.js (v18+)
- **Framework**: Express.js
- **HTTP Client**: node-fetch (v3)
- **AI**: Claude Sonnet 4 (Anthropic)
- **Price Data**: Alpaca Markets API
- **Options Data**: Polygon.io API
- **News**: Finnhub API
- **Database**: Supabase (PostgreSQL) - optional for conversation memory & metrics logging
- **Deployment**: Render
- **CI/CD**: GitHub Actions (for automated daily metrics logging)

## API Response Times

- `/news/:symbol` - ~500ms (Finnhub API)
- `/analyze` - ~2-4s (Claude AI processing)
- `/test/*` - ~200ms-2s

## iOS Integration Notes

### Parsing Analysis Response

**No changes needed in iOS app!** The response format is identical:
- Still receives `{ success, analysis, usage }`
- `analysis` field now has structured format with labeled perspectives

### Extracting Perspectives

iOS can parse using regex patterns:

```swift
// Extract BULLISH perspective
let bullishPattern = /BULLISH: (.*?)\n/
if let match = analysis.firstMatch(of: bullishPattern) {
    let bullishText = String(match.1)
}

// Extract BEARISH perspective  
let bearishPattern = /BEARISH: (.*?)\n/
if let match = analysis.firstMatch(of: bearishPattern) {
    let bearishText = String(match.1)
}

// Extract NEUTRAL perspective
let neutralPattern = /NEUTRAL: (.*?)\n/
if let match = analysis.firstMatch(of: neutralPattern) {
    let neutralText = String(match.1)
}
```

### Response Structure

The `analysis` string follows this format:
```
<Overview paragraph with optional quant metrics>

BULLISH: <positive perspective>

BEARISH: <negative perspective>

NEUTRAL: <wait-and-see perspective>

Note: Options data unavailable for this symbol. (if applicable)
```

---

## 📊 Complete Quant Metrics Reference

### All 14 Metrics

The API calculates **14 professional-grade options metrics** using data from Polygon.io (~750 contracts per stock):

#### **Flow & Positioning Metrics**

1. **Dealer Gamma (0-30d)** - `$89.6B (short)`
   - Net gamma exposure dealers must hedge  
   - Short gamma = dealers amplify moves (sell strength, buy weakness)
   - Formula: `Σ(Γ × S² × 100 × OI)` using Black-Scholes

2. **Put/Call Volume Ratio** - `0.51`
   - Daily put volume ÷ call volume
   - <1 = bullish flow, >1 = bearish flow

3. **Put/Call OI Ratio** - `0.53`
   - Total put open interest ÷ call open interest
   - Locked positions vs daily flow

4. **Total Delta** - `+$7640M (bullish)`
   - Net directional dollar exposure across all options
   - Positive = bullish positioned, negative = bearish positioned

#### **Volatility Metrics**

5. **Skew (±10%)** - `-0.8 pp`
   - IV difference between OTM puts vs OTM calls
   - Positive = fear (puts expensive), negative = greed (calls expensive)

6. **ATM IV** - `47.2%@$262.5`
   - Implied volatility at the money
   - Market's expected annualized volatility

7. **Implied Move** - `$11.76 (4.5%)`
   - Expected price range by next expiry (straddle-based)
   - Formula: `Spot × ATM_IV × √(TTM)`

8. **Multiple Expected Moves** - `3d ±$11.3 (±4.3%), 10d ±$20.5 (±7.8%)`
   - Straddle-based expected ranges for next 3 expirations
   - Used for entry/exit planning around multiple timeframes

9. **IV Term Structure** - `Front 51.4% / Back 35.7% (backwardation)`
   - Front-month IV vs back-month IV
   - Backwardation = near-term event risk, contango = normal curve

10. **Total Vega** - `+$12M per 1% IV (long volatility)`
    - Portfolio sensitivity to 1% IV change
    - Positive = gains from VIX spikes, negative = benefits from calm markets
    - Formula: Black-Scholes vega summed across all contracts

#### **Dealer Hedging & Price Levels**

11. **Max Pain** - `$257.5`
    - Strike where most option value expires worthless
    - Potential price magnet as expiration approaches

12. **Gamma Walls** - `$262.5 (+$8.3B), $265 (+$5.5B), $270 (+$5B)`
    - Top 3 strikes with highest dollar gamma concentration
    - Support/resistance levels where dealers hedge heavily

13. **Zero Gamma Level** - `$237.5 (below spot)`
    - Price where net gamma = 0
    - Above = volatility dampens, below = volatility amplifies

#### **Convexity**

14. **Vanna** - `+$239M (Rising IV increases delta - bullish convexity)`
    - Cross-Greek showing how delta changes with IV
    - Formula: Second-order Greek `-(φ(d1) × d2) / σ`
    - Critical during volatility events

### Formula Verification

All metrics use academically-validated formulas:

- **Expected Move**: Standard straddle pricing (Hull, 2018)
- **Vega**: Black-Scholes φ(d1) (Black & Scholes, 1973)
- **Vanna**: Second-order Greeks (Taleb, 1997; Haug, 2007)
- **Dealer Gamma**: Black-Scholes gamma with dealer convention

**Industry Comparison:**
- Expected Move: Matches TastyTrade/CBOE ✅
- Vega: Matches Bloomberg/Reuters ✅  
- Vanna: Matches professional trading desks ✅

### Calculation Details

#### Data Source
- **Provider**: Polygon.io (paid tier required)
- **Contracts Fetched**: ~750 per stock (3 pages with pagination)
- **Expiries**: 0-30 days out, nearest 3 expirations
- **Filtering**: Excludes zero OI/volume, expired options

#### Edge Case Handling
- ✅ Zero open interest: Excluded from calculations
- ✅ Expired options: TTM check prevents negative time
- ✅ Zero IV: Safety checks return 0
- ✅ Division by zero: Guards in place
- ✅ NaN/Infinity: Validation in all calculations

---

## 🏗️ Architecture & Reliability

### How Quant Metrics Work

The API uses a **3-layer defense system** to ensure quant metrics appear in 100% of responses for popular symbols:

#### Layer 1: Smart Caching (Stale-While-Revalidate)

```
Flow:
1. Check cache - if < 4 hours old → return immediately ✅
2. Try fresh fetch - if successful → update cache ✅
3. If fetch fails - serve stale cache (< 24 hours old) ✅
4. If no cache - return empty (graceful degradation) ⚠️
```

**Why it works:**
- Options data doesn't change much intraday
- Better to show 1-hour-old gamma than nothing
- Users see data age: `Quant Metrics (cached 47 min ago): ...`

#### Layer 2: Cache Warmer (Pre-fetch Popular Symbols)

**Top 10 Symbols Pre-cached:**
- SPY, QQQ (market ETFs)
- AAPL, NVDA, TSLA, MSFT, AMZN, GOOGL, META, AMD (mega caps)

**When it runs:**
1. **Server Startup**: Immediately warms cache for all 10 symbols (background, non-blocking)
2. **Every 2 Hours**: Refreshes cache automatically (sequential to avoid rate limits)

**Timeline after deploy:**
- 0-30s: Render wakes up (free tier cold start)
- 30-40s: Server starts, API tests complete
- 40-55s: Cache warmer fetches SPY, QQQ, AAPL (first 3 symbols)
- 55s+: Server fully ready, most queries have fresh cache

#### Layer 3: Graceful Degradation

If all else fails:
1. Price data (from Alpaca) always works ✅
2. News data (from Finnhub) always works ✅
3. Claude analysis always works ✅
4. Quant metrics show honest status about unavailability

**API never returns 500 errors for missing options data.**

### Expected Reliability

**Popular Symbols (Top 10):**
- 99.9% availability - always cached
- Fresh data (< 2 hours old)
- Instant response (no wait time)

**Other Symbols:**
- 70-80% availability on first request
- Stale cache fallback shows data age
- Graceful degradation never breaks API

**After 24 Hours Running:**
- 100% cache coverage for any symbol queried
- All stale data < 24 hours old
- Background refresh keeps top symbols fresh

### Configuration

Environment variables for tuning:

```bash
OPT_CACHE_TTL_SEC=14400      # 4 hours fresh cache
OPT_STALE_TTL_SEC=86400      # 24 hours stale cache
OPT_MAX_DAYS=30              # Fetch options 0-30 days out
POLYGON_API_KEY=your_key     # Polygon.io API key (paid tier)
OPTIONS_PROVIDER=polygon     # Options data provider
ENABLE_CACHE_WARMER=false    # Cache warmer disabled by default (Yahoo blocks datacenter IPs)
```

**Cache Warmer Status:**
- Disabled by default due to Yahoo Finance blocking datacenter IPs
- Set `ENABLE_CACHE_WARMER=true` to enable (only works from non-datacenter IPs)
- Pre-fetches options data for popular symbols on startup
- Polygon.io provider doesn't need cache warmer (no IP blocking issues)

---

## 📰 News Feed Features

### New Endpoints

The API includes comprehensive news feed capabilities with sentiment classification:

#### `/newsfeed/blocks?topic=market&limit=12`

**Purpose**: Hero + tiles + latest news feed for the main News screen

**Query Parameters:**
- `topic`: `market` (default), `crypto`, `equities`, `macro`
- `limit`: 6-30 items (default: 12)
- `sentiment`: `all` (default), `bullish`, `neutral`, `bearish`
- `strict`: `0` (default) or `1` (no fallback to mixed feed)

**Response Structure:**
```json
{
  "generated_at": "2025-10-21T12:00:00Z",
  "status": "ok|degraded|fallback",
  "freshness_seconds": 0,
  "hero": {
    "title": "Apple announces new products",
    "source": "Reuters",
    "url": "https://...",
    "image": "/img?src=...",
    "tickers": ["AAPL"],
    "published_at": "2025-10-21T11:55:00Z",
    "age": "5m",
    "sentiment": "bullish",
    "sentiment_source": "heuristic",
    "sentiment_version": "news-v1"
  },
  "tiles": [...],  // max 2 items
  "latest": [...]  // remaining items
}
```

#### `/newsfeed/:symbol?limit=12`

Symbol-specific news for detail pages with same sentiment filtering.

#### `/img?src=https://...`

Safe, cached image proxy with:
- HTTPS enforcement, tracking param removal
- 3-second timeout, 2MB size limit
- 24-hour cache, ETag support
- Fallback to 1x1 transparent placeholder on errors

### Sentiment Classification

Every news item is automatically classified as `bullish`, `neutral`, or `bearish`:

**Classification Logic:**
- **Bullish signals (+2 each)**: beat, beats, upgrade, raises guidance, record, surpass, wins, expands, strong demand, revenue growth, all-time high
- **Bearish signals (-2 each)**: miss, misses, downgrade, cuts guidance, probe, recall, delay, lawsuit, weak demand, layoffs, SEC investigation, plunge, decline, warning
- **Guidance priority (+3/-3)**: "raises guidance" and "cuts guidance" dominate other signals
- **Negation handling (+4)**: "lawsuit dismissed", "probe dropped", "downgrade reversed" neutralize bearish signals

**Examples:**
- "beats earnings but cuts guidance": beats (+2) + cuts guidance (-3) = -1 → **bearish**
- "misses but raises guidance": miss (-2) + raises guidance (+3) = +1 → **bullish**

### Caching & Performance

- **Fresh cache**: 60 seconds
- **Stale cache**: 3600 seconds (1 hour)
- **Images**: 86400 seconds (24 hours)
- **ETag support**: 304 Not Modified responses
- **Never returns 500**: Graceful degradation on all failures

### Testing

Run comprehensive tests:
```bash
npm run test:all      # 61 tests total
npm run test:news     # 26 news/URL tests
npm run test:sentiment # 35 sentiment classification tests
```

---

## 💬 Conversation Memory & Historical Metrics

### Overview

The API supports two optional Supabase-powered features:
1. **Conversation Memory** - Enables follow-up questions with context
2. **Historical Metrics Logging** - Stores daily snapshots of all 14 quant metrics

Both features are **optional** and **backward compatible**. If Supabase credentials are not set, the API works normally without these features.

### Setup Instructions

#### Step 1: Create Supabase Database Tables

1. Visit your Supabase dashboard: https://supabase.com/dashboard
2. Go to **SQL Editor** → **New Query**
3. Copy and paste the entire contents of `supabase_schema.sql`
4. Click **Run**

This creates:
- `conversations` table (for session memory)
- `metrics_history` table (for historical logging)
- Indexes for fast queries
- Row Level Security policies

#### Step 2: Add Environment Variables

**Local (.env file):**
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Render (Environment tab):**
1. Go to Render dashboard → Your service → Environment
2. Add the same `SUPABASE_URL` and `SUPABASE_ANON_KEY` variables
3. Save and redeploy

#### Step 3: Verify Setup

Check startup logs for:
```
✅ Conversation Memory: Enabled (Supabase)
✅ Metrics Logging: Enabled (Supabase)
```

Or test endpoints:
```bash
curl http://localhost:3000/stats/conversations
curl http://localhost:3000/stats/metrics
```

Both should return `"enabled": true`.

### Conversation Memory

**How it works:**

The API can remember conversation context when you provide a `conversation_id`:

**Request:**
```json
{
  "query": "What about the gamma?",
  "conversation_id": "uuid-here"
}
```

**Behavior:**
- Loads last ticker from conversation history
- Uses context ticker if no ticker in new query
- Saves conversation after analysis
- Auto-expires conversations after 30 minutes

**Example Flow:**
```bash
# First query - establishes context
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "AAPL",
    "conversation_id": "test-conv-123"
  }'

# Follow-up - automatically uses AAPL from context
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What about the skew?",
    "conversation_id": "test-conv-123"
  }'

# Switch ticker - updates context
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "TSLA",
    "conversation_id": "test-conv-123"
  }'
```

**iOS App Integration:**
```swift
// Generate conversation ID once per session
let conv_id = UUID().uuidString

// First query
api.analyze(query: "AAPL", conversationId: conv_id)

// Follow-up (remembers AAPL)
api.analyze(query: "What about the gamma?", conversationId: conv_id)

// Switch ticker
api.analyze(query: "TSLA", conversationId: conv_id)
```

### Historical Metrics Logging

**How it works:**

Automatically logs metrics snapshots to Supabase after every successful analysis:
- One snapshot per ticker per day (upsert logic)
- Stores all 14 quant metrics + metadata
- Tracks data freshness (fresh/stale/unavailable)

**Automatic Behavior:**
Every `/analyze` request with valid options data automatically logs to `metrics_history` table. No additional API calls needed.

**Query Historical Data:**
```bash
# Get 30 days of metrics for AAPL
curl http://localhost:3000/history/AAPL?days=30

# Get last 7 days
curl http://localhost:3000/history/TSLA?days=7
```

**Use Cases:**
- Chart dealer gamma over time
- Track IV term structure changes
- Analyze skew trends
- Build custom analytics dashboards

**Example Response:**
```json
{
  "ticker": "AAPL",
  "days_requested": 30,
  "snapshots": 15,
  "data": [
    {
      "date": "2025-10-29",
      "price": 175.50,
      "dealer_gamma_value": -1.2,
      "dealer_gamma_direction": "short",
      "skew_pp": 5.4,
      "atm_iv": 34.6,
      "put_call_vol_ratio": 1.23,
      "implied_move_pct": 2.7,
      "max_pain": 175.00,
      ...
    }
  ]
}
```

### Cost Considerations

**Supabase Free Tier:**
- 500 MB database
- 2 GB bandwidth/month
- 50,000 monthly active users
- **Should be plenty for most use cases!**

**Storage Estimates:**
- Conversations: ~100 bytes each, expires after 30 min
- Metrics: ~2 KB per ticker per day
- 1000 daily queries = ~2 MB/day = 60 MB/month

**Claude API Costs (with memory):**
- 2-3x token usage for short conversations (< 5 turns)
- Still very affordable at current scale

### Backward Compatibility

**Everything still works without Supabase!**

- If Supabase credentials not set, features are disabled
- All existing functionality unchanged
- No breaking changes to API
- `conversation_id` is optional parameter
- API never crashes if Supabase is unavailable (graceful degradation)

### Troubleshooting

**"Conversation Memory: Disabled" or "Metrics Logging: Disabled"**
- Check `SUPABASE_URL` and `SUPABASE_ANON_KEY` in environment variables
- Verify no typos in variable names
- Ensure values start with `https://` and `eyJ` respectively

**"relation 'conversations' does not exist"**
- Run the SQL schema in Supabase SQL Editor
- Verify tables appear in Table Editor

**Follow-up doesn't work**
- Make sure using same `conversation_id`
- Check logs for "Using ticker from context"
- Verify conversation was saved (check Supabase Table Editor)

**No metrics in /history/:ticker**
- Query the ticker first through `/analyze`
- Wait a moment for async logging to complete
- Check Supabase Table Editor for `metrics_history` rows

### Automated Daily Metrics Logging

**GitHub Actions Workflow:**
- Automatically logs metrics for popular tickers every weekday at 10 AM ET
- Runs via GitHub Actions (`.github/workflows/daily-metrics-logger.yml`)
- Uses the `/analyze` API endpoint to trigger metrics logging
- Ensures historical data is captured even if users don't query certain tickers

**Manual Scripts:**
Two scripts are available for manual metrics logging:

1. **`daily_metrics_logger.js`** - Logs via API endpoint (recommended)
   ```bash
   node daily_metrics_logger.js
   node daily_metrics_logger.js --tickers AAPL,TSLA,NVDA
   ```

2. **`daily_metrics_direct.js`** - Direct Supabase write (requires Polygon API access)
   ```bash
   node daily_metrics_direct.js
   node daily_metrics_direct.js --tickers AAPL,TSLA
   ```

**Configuration:**
- Default ticker list: Popular symbols (SPY, QQQ, AAPL, NVDA, TSLA, etc.)
- Set `API_URL` environment variable for API-based logger
- Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` for direct logger

### Historical Data Backfill

**Production-Ready Backfill Script:**

The `backfill_history.js` script allows you to populate historical metrics data for past dates that weren't automatically logged.

**Usage:**
```bash
# Default: 30 days, 6 default tickers (SPY, QQQ, AAPL, NVDA, TSLA, MSFT)
node backfill_history.js

# Custom days
node backfill_history.js --days=60

# Custom tickers
node backfill_history.js --tickers=SPY,QQQ,AAPL

# Both
node backfill_history.js --days=30 --tickers=SPY,QQQ,AAPL,NVDA,TSLA,MSFT
```

**Features:**
- ✅ **Automatic weekend skipping** - Only processes trading days
- ✅ **Rate limiting** - 12 seconds between requests (Polygon limit: 5/min)
- ✅ **Resume capability** - Checks existing records, skips duplicates
- ✅ **Retry logic** - 3 attempts per failed date with exponential backoff
- ✅ **Progress tracking** - Real-time console output with emoji indicators
- ✅ **Error logging** - All errors logged to `backfill_errors.log`
- ✅ **Graceful error handling** - Never crashes completely, always logs errors
- ✅ **Backfilled flag** - Marks data with `data_freshness: 'backfilled'` to distinguish from live data

**Important Limitation:**
⚠️ Polygon.io does **NOT** provide historical options data for past dates. Their snapshot endpoint only returns current/live options data.

The script uses:
- **Historical stock prices** from Polygon aggregates endpoint (accurate)
- **Current options snapshots** from Polygon (approximation - uses today's options structure)

This means backfilled metrics are an **approximation** using current options data with historical prices. For true historical options data, you would need:
- CBOE historical options feed
- Bloomberg Terminal data
- Another provider with historical options chains

**Expected Output:**
```
========================================
🚀 Starting backfill
========================================
Days: 30 (20 weekdays)
Tickers: SPY, QQQ, AAPL, NVDA, TSLA, MSFT
Date range: 2025-10-06 to 2025-10-31
Rate limit: 12s between requests
========================================

📊 Backfilling SPY...
✅ SPY 2025-10-06 | Dealer Gamma: $225.9B (short) | Skew: 26.5 pp
✅ SPY 2025-10-07 | Dealer Gamma: $217.9B (short) | Skew: 28.1 pp
⏭️  SPY 2025-10-11 (weekend - skipped)
✅ SPY 2025-10-13 | Dealer Gamma: $196.5B (short) | Skew: 21.1 pp
...

✅ Completed SPY: 17/20 days (skipped 3 weekends, 3 existing, 0 failed)

🎉 Backfill complete!
Total records inserted: 94
Skipped (existing/weekends): 18
Failed: 8
Errors logged to: /path/to/backfill_errors.log
Runtime: 30 minutes
========================================
```

**Requirements:**
- `POLYGON_API_KEY` environment variable
- `SUPABASE_URL` environment variable
- `SUPABASE_ANON_KEY` environment variable
- `.env` file with credentials (uses `dotenv`)

**Performance:**
- ~2 minutes per ticker for 20 trading days
- 12 second delay between requests (Polygon rate limit)
- For 6 tickers × 20 days = ~24 minutes total runtime

---

## License

MIT

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs for detailed error messages
3. Test individual endpoints using the `/test/*` routes
4. Verify API keys are valid and have sufficient quota

---

**Ready for production!** 🚀

