#!/bin/bash

# Test Metrics Logging
# Tests that metrics are properly saved to Supabase

API_URL="${API_URL:-https://ainews-ybbv.onrender.com}"

echo "========================================"
echo "🧪 TESTING METRICS LOGGING"
echo "========================================"
echo "API: $API_URL"
echo "Time: $(date)"
echo ""

# Step 1: Check initial stats
echo "Step 1: Check initial metrics stats"
echo "---"
INITIAL_STATS=$(curl -s "$API_URL/stats/metrics")
INITIAL_COUNT=$(echo "$INITIAL_STATS" | jq -r '.total_snapshots')
echo "Initial snapshots: $INITIAL_COUNT"
echo ""

# Step 2: Query a ticker to trigger logging
echo "Step 2: Query AAPL to trigger metrics logging"
echo "---"
RESPONSE=$(curl -s -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -d '{"query": "AAPL", "news": ""}')

HAS_QUANT=$(echo "$RESPONSE" | jq -r '.analysis' | grep -q "Quant Metrics:" && echo "YES" || echo "NO")
echo "Has Quant Metrics: $HAS_QUANT"

if [ "$HAS_QUANT" = "YES" ]; then
    echo "✅ Analysis returned with quant metrics"
else
    echo "⚠️  Analysis returned without quant metrics (markets may be closed)"
fi
echo ""

# Step 3: Wait a moment for async logging
echo "Step 3: Wait 3 seconds for async logging..."
sleep 3
echo ""

# Step 4: Check updated stats
echo "Step 4: Check updated metrics stats"
echo "---"
UPDATED_STATS=$(curl -s "$API_URL/stats/metrics")
UPDATED_COUNT=$(echo "$UPDATED_STATS" | jq -r '.total_snapshots')
echo "Updated snapshots: $UPDATED_COUNT"
echo ""

# Step 5: Try to get AAPL history
echo "Step 5: Check AAPL history"
echo "---"
HISTORY=$(curl -s "$API_URL/history/AAPL?days=1")
SNAPSHOTS=$(echo "$HISTORY" | jq -r '.snapshots')
echo "AAPL snapshots found: $SNAPSHOTS"

if [ "$SNAPSHOTS" -gt 0 ]; then
    echo ""
    echo "Latest snapshot:"
    echo "$HISTORY" | jq -r '.data[0] | "Date: \(.date)\nGamma: \(.dealer_gamma_value // "N/A")\nSpot: $\(.spot_price // "N/A")\nFreshness: \(.data_freshness)"'
fi
echo ""

# Step 6: Query another ticker
echo "Step 6: Query TSLA to test multiple tickers"
echo "---"
curl -s -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -d '{"query": "TSLA", "news": ""}' | jq -r '.analysis' | head -3

sleep 3
echo ""

# Step 7: Final stats check
echo "Step 7: Final metrics stats"
echo "---"
FINAL_STATS=$(curl -s "$API_URL/stats/metrics")
echo "$FINAL_STATS" | jq '.'
echo ""

# Summary
echo "========================================"
echo "📊 TEST SUMMARY"
echo "========================================"
echo "Initial snapshots: $INITIAL_COUNT"
echo "Updated snapshots: $UPDATED_COUNT"
echo "Final snapshots: $(echo "$FINAL_STATS" | jq -r '.total_snapshots')"
echo "Unique tickers: $(echo "$FINAL_STATS" | jq -r '.unique_tickers')"

DIFF=$(($(echo "$FINAL_STATS" | jq -r '.total_snapshots') - INITIAL_COUNT))
if [ $DIFF -gt 0 ]; then
    echo ""
    echo "✅ SUCCESS: $DIFF new snapshot(s) logged!"
elif [ "$HAS_QUANT" = "YES" ]; then
    echo ""
    echo "⚠️  Metrics may already exist for today (one per ticker per day)"
else
    echo ""
    echo "⚠️  No new snapshots (markets may be closed)"
fi

echo "========================================"

