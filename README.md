# AI News Stock Analysis API

A Node.js Express API that provides stock analysis using Claude AI and real-time news from Finnhub. Built for iOS integration and deployed on Render.

## Features

- 🤖 AI-powered stock analysis using Claude Sonnet 4
- 📰 Real-time stock news from Finnhub (last 24 hours)
- 🔍 Multiple perspectives: Bullish, Bearish, and Neutral analysis
- ✅ Built-in API key testing endpoints
- 🚀 Production-ready with proper error handling
- 🌐 CORS enabled for iOS app integration

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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_API_KEY` | Yes | Your Anthropic Claude API key |
| `FINNHUB_API_KEY` | Yes | Your Finnhub API key |
| `PORT` | No | Server port (default: 3000, auto-set on Render) |

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

