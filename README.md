# AI News Stock Analysis API

A Node.js Express API that provides stock analysis using Claude AI and real-time news from Finnhub. Built for iOS integration and deployed on Render.

## Features

- 🤖 **AI-powered stock analysis** using Claude Sonnet 4
- 📰 **Real-time stock news** from Finnhub (last 24 hours)
- 💰 **Live price data** from Alpaca Markets
- 📊 **Options analytics** with Yahoo Finance (dealer gamma, skew)
- 🔍 **Multiple perspectives**: Bullish, Bearish, and Neutral analysis
- 🛡️ **Investment advice guardrails** - never recommends buy/sell/hold
- 🧮 **Quant metrics**: Dealer Gamma (0-30d), Skew (±10% OTM)
- 🎯 **Symbol extraction** - automatically detects tickers from queries
- ✅ **Built-in API key testing** endpoints
- 🚀 **Production-ready** with proper error handling
- 🌐 **CORS enabled** for iOS app integration

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
        "provider": "Alpaca|yfinance|Finnhub",
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

### ✅ Options Chain via Yahoo Finance
- **Endpoint**: https://query2.finance.yahoo.com/v7/finance/options/{symbol}
- **Caching**: 3-minute cache per symbol to avoid throttling
- **Data Parsed**: calls[], puts[] with impliedVolatility, openInterest, volume, strike, expirationDate
- **Graceful Failure**: Sets `optionsUnavailable: true` on errors, never throws

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
  2. **Try Fresh Fetch**: Attempt to fetch new data from yfinance
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
PORT=3000
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
  "news": "Tesla shares fall 5% after Q3 earnings miss... Elon Musk announces new factory delays..."
}
```

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

## Local Python Bridge (yfinance)

This service includes a **local Python helper** for options analytics using `yfinance`. It runs in the SAME Render service (no additional services needed).

### How It Works

1. **Python Bridge** (`./pybridge/options_bridge.py`):
   - Fetches options chains from Yahoo Finance via yfinance
   - Returns spot price, strikes, IV, OI for 0-30d expiries
   - Outputs clean JSON for Node.js consumption

2. **Node Wrapper** (`./lib/optionsProvider.js`):
   - Spawns Python process with 15s timeout
   - **Smart caching**: Fresh cache (4 hours), stale cache (24 hours)
   - **Stale-while-revalidate**: Serves cached data if fresh fetch fails
   - Gracefully degrades if Python unavailable
   - Always shows data age in quant line when using cached data

3. **Quant Calculations**:
   - **Dealer Gamma (0-30d)**: Black-Scholes gamma × S² × 100 × OI, dealer convention (short/long)
   - **Skew (±10% OTM)**: IV difference between 0.9S puts and 1.1S calls

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_API_KEY` | Yes | Your Anthropic Claude API key |
| `FINNHUB_API_KEY` | Yes | Your Finnhub API key |
| `ALPACA_API_KEY` | Yes | Your Alpaca Markets API key |
| `ALPACA_SECRET_KEY` | Yes | Your Alpaca Markets secret key |
| `OPTIONS_PROVIDER` | No | Options data source: `polygon` (recommended) or `yfinance-local` (default: `polygon`) |
| `POLYGON_API_KEY` | Conditional | Required if `OPTIONS_PROVIDER=polygon` |
| `OPT_MAX_DAYS` | No | Max days for options expiries (default: `30`) |
| `OPT_EXPIRIES` | No | Number of expiries to fetch (default: `5`) - only for yfinance |
| `OPT_CACHE_TTL_SEC` | No | Fresh cache TTL in seconds (default: `14400` = 4 hours) |
| `OPT_STALE_TTL_SEC` | No | Stale cache TTL in seconds (default: `86400` = 24 hours) |
| `PYTHON_BIN` | No | Python binary path (default: `python3`) - only for yfinance |
| `PORT` | No | Server port (default: 3000, auto-set on Render) |
| `BASE_PUBLIC_URL` | No | Public base URL for absolute URLs (e.g., `https://ainews-ybbv.onrender.com`) |

### Example Output with Quant

```json
{
  "success": true,
  "analysis": "NVDA rose 3.1% today on strong AI chip demand. Quant: Dealer Gamma (0-30d): -$1.2B (short); Skew (±10%): 5.4 pp; ATM IV: 34.6%@485; Put/Call Vol Ratio: 1.23; Implied Move: $12.80 (2.7%).\n\nBULLISH: Strong demand momentum...\n\nBEARISH: Valuation concerns...\n\nNEUTRAL: Wait for confirmation...\n\n—\nData sources:\n• Alpaca (price @ 14:32 UTC)\n• Options (yfinance local @ 14:30 UTC)\n• Finnhub (news @ 14:31 UTC)"
}
```

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
- **News**: Finnhub API
- **Deployment**: Render

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

