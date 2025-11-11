#!/bin/bash

echo "=========================================="
echo "Testing Historical Metrics Integration"
echo "=========================================="
echo ""

API_URL="https://ainews-ybbv.onrender.com"

echo "1. Checking if metrics logging is enabled..."
STATS=$(curl -s "$API_URL/stats/metrics")
ENABLED=$(echo "$STATS" | jq -r '.enabled // false')

if [ "$ENABLED" != "true" ]; then
  echo "❌ Metrics logging is NOT enabled"
  exit 1
fi

echo "✅ Metrics logging is enabled"
echo ""

echo "2. Checking historical data for AAPL..."
HISTORY=$(curl -s "$API_URL/history/AAPL?days=7")
SNAPSHOTS=$(echo "$HISTORY" | jq -r '.snapshots // 0')

echo "   Found $SNAPSHOTS snapshots"
if [ "$SNAPSHOTS" -gt 0 ]; then
  echo "   ✅ Historical data exists"
  echo ""
  echo "   Sample data:"
  echo "$HISTORY" | jq '.data[0] | {date, dealer_gamma_value, skew_value, atm_iv_value}' 2>/dev/null || echo "   (Unable to parse)"
else
  echo "   ⚠️  No historical data found"
fi
echo ""

echo "3. Making analysis request to test integration..."
echo "   Query: AAPL"
ANALYSIS=$(curl -s -X POST "$API_URL/analyze" \
  -H "Content-Type: application/json" \
  -d '{"query": "AAPL", "news": ""}')

if echo "$ANALYSIS" | jq -e '.success' > /dev/null 2>&1; then
  echo "   ✅ Analysis completed"
  
  # Check if analysis text contains historical context keywords
  ANALYSIS_TEXT=$(echo "$ANALYSIS" | jq -r '.analysis // ""' | tr '[:upper:]' '[:lower:]')
  
  if echo "$ANALYSIS_TEXT" | grep -q "7-day\|average\|historical\|trend\|vs"; then
    echo "   ✅ Analysis appears to include historical context"
  else
    echo "   ⚠️  No historical keywords found (may still be using historical data)"
  fi
else
  echo "   ❌ Analysis failed"
  echo "$ANALYSIS" | jq '.' 2>/dev/null || echo "$ANALYSIS"
fi

echo ""
echo "=========================================="
echo "Next: Check server logs for:"
echo "  '📊 Loaded X days of historical metrics for trend analysis'"
echo "=========================================="


