# Supabase Setup Guide

## ✅ Code Implementation Complete!

All code has been added for:
1. **Conversation Memory** - Follow-up questions with context
2. **Historical Metrics Logging** - Daily snapshots of all 14 metrics

## 🎯 Next Step: Create Database Tables

### Step 1: Go to Supabase SQL Editor

1. Visit: https://supabase.com/dashboard/project/cyyyqpbdhkycqmsptvjk
2. Click "SQL Editor" in the left sidebar
3. Click "New Query"

### Step 2: Run the Schema SQL

Copy and paste the entire contents of `supabase_schema.sql` into the SQL editor and click "Run".

This will create:
- `conversations` table (for session memory)
- `metrics_history` table (for historical logging)
- Indexes for fast queries
- Row Level Security policies

### Step 3: Verify Tables Were Created

In the Supabase dashboard:
1. Go to "Table Editor"
2. You should see:
   - `conversations` (5 columns)
   - `metrics_history` (24+ columns)

---

## 🧪 Testing Locally

Once tables are created, test locally:

```bash
cd /Users/user/ainews
node server.js
```

Look for these startup messages:
```
✅ Conversation Memory: Enabled (Supabase)
✅ Metrics Logging: Enabled (Supabase)
```

### Test Conversation Memory

```bash
# Terminal 1: Start server
node server.js

# Terminal 2: Test conversation
# First query with conversation_id
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "AAPL",
    "news": "",
    "conversation_id": "test-conv-123"
  }'

# Follow-up without ticker (uses context)
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What about the gamma?",
    "news": "",
    "conversation_id": "test-conv-123"
  }'
```

### Test Metrics Logging

```bash
# Query any stock - it will auto-log metrics
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"query": "TSLA", "news": ""}'

# Check stats
curl http://localhost:3000/stats/metrics

# Get history for TSLA
curl http://localhost:3000/history/TSLA?days=7
```

---

## 📊 New API Endpoints

### GET /stats/conversations
Returns conversation memory stats:
```json
{
  "enabled": true,
  "total": 42,
  "active": 12
}
```

### GET /stats/metrics
Returns metrics logging stats:
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

### GET /history/:ticker?days=30
Returns historical metrics for a ticker:
```json
{
  "ticker": "AAPL",
  "days_requested": 30,
  "snapshots": 15,
  "data": [...]
}
```

---

## 🔥 How It Works

### Conversation Memory

**Request:**
```json
{
  "query": "What about gamma?",
  "conversation_id": "uuid-here"
}
```

**Behavior:**
- Server loads last ticker from conversation
- Uses context ticker if no ticker in new query
- Saves conversation after analysis
- Auto-expires conversations after 30 min

### Metrics Logging

**Automatic:**
- Every successful `/analyze` call logs metrics to database
- One snapshot per ticker per day (upsert)
- Stores all 14 quant metrics + metadata
- Tracks data freshness (fresh/stale/unavailable)

---

## 🚀 Deploy to Production

### Step 1: Add Supabase Credentials to Render

1. Go to: https://dashboard.render.com/
2. Select your `ainews` service
3. Go to "Environment"
4. Add:
   ```
   SUPABASE_URL=https://cyyyqpbdhkycqmsptvjk.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
5. Click "Save Changes"

### Step 2: Deploy

Render will auto-deploy after you push to GitHub, or manually click "Deploy latest commit".

### Step 3: Verify

Visit:
- https://ainews-ybbv.onrender.com/stats/conversations
- https://ainews-ybbv.onrender.com/stats/metrics

Should show `"enabled": true`

---

## 💡 Usage Examples

### iOS App Integration

```swift
// First query
let conv_id = UUID().uuidString
api.analyze(query: "AAPL", conversationId: conv_id)

// Follow-up (remembers AAPL)
api.analyze(query: "What about the skew?", conversationId: conv_id)

// Switch ticker
api.analyze(query: "TSLA", conversationId: conv_id)

// Follow-up (remembers TSLA now)
api.analyze(query: "What's the expected move?", conversationId: conv_id)
```

### Historical Data Charting

```javascript
// Get 30 days of gamma for AAPL
fetch('/history/AAPL?days=30')
  .then(r => r.json())
  .then(data => {
    const gammas = data.data.map(d => ({
      date: d.date,
      gamma: d.dealer_gamma_value,
      direction: d.dealer_gamma_direction
    }));
    
    // Plot on chart...
  });
```

---

## ⚠️ Important Notes

### Cost Considerations

**Supabase Free Tier:**
- 500 MB database
- 2 GB bandwidth/month
- 50,000 monthly active users
- **Should be plenty for your use case!**

**If you exceed free tier:**
- Conversations: ~100 bytes each, expires after 30 min
- Metrics: ~2 KB per ticker per day
- 1000 daily queries = ~2 MB/day = 60 MB/month

**Claude API Costs (with memory):**
- 2-3x token usage for short conversations (< 5 turns)
- Still very affordable at your current scale

### Backward Compatibility

**Everything still works without Supabase!**

- If Supabase credentials not set, features are disabled
- All existing functionality unchanged
- No breaking changes to API
- conversation_id is optional parameter

---

## 🎯 Testing Checklist

- [ ] Database tables created in Supabase
- [ ] Server starts with "Conversation Memory: Enabled"
- [ ] Server starts with "Metrics Logging: Enabled"
- [ ] `/stats/conversations` returns enabled: true
- [ ] `/stats/metrics` returns enabled: true
- [ ] First query with conversation_id works
- [ ] Follow-up query without ticker uses context
- [ ] `/history/AAPL` returns data after querying AAPL
- [ ] Render environment variables added
- [ ] Production deployment verified

---

## 🐛 Troubleshooting

**"Conversation Memory: Disabled"**
- Check SUPABASE_URL and SUPABASE_ANON_KEY in .env
- Verify no typos in environment variables

**"relation 'conversations' does not exist"**
- Run the SQL schema in Supabase SQL Editor
- Verify tables appear in Table Editor

**Follow-up doesn't work**
- Make sure using same conversation_id
- Check logs for "Using ticker from context"
- Verify conversation was saved (check Supabase Table Editor)

**No metrics in /history/:ticker**
- Query the ticker first through /analyze
- Wait a moment for async logging
- Check Supabase Table Editor for metrics_history rows

---

Ready to set up! Let me know once you've run the SQL schema and I'll help test everything.

