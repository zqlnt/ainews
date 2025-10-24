#!/bin/bash

echo "=================================================="
echo "🧪 Testing Quant Metrics on Render"
echo "=================================================="
echo ""

BASE_URL="https://ainews-ybbv.onrender.com"

echo "1️⃣  Testing health endpoint..."
HEALTH=$(curl -s "$BASE_URL/" | jq -r '.status')
echo "   Status: $HEALTH"
echo ""

echo "2️⃣  Testing /analyze with AAPL (should have quant metrics)..."
echo "   Sending request..."
RESPONSE=$(curl -s -X POST "$BASE_URL/analyze" \
  -H "Content-Type: application/json" \
  -d '{"query": "Why did AAPL move today?", "news": ""}')

echo ""
echo "   Response analysis (first 500 chars):"
echo "$RESPONSE" | jq -r '.analysis' | head -c 500
echo ""
echo ""

# Check for quant metrics
if echo "$RESPONSE" | grep -q "Dealer Gamma"; then
    echo "   ✅ QUANT METRICS FOUND!"
    echo ""
    echo "   Extracting quant line:"
    echo "$RESPONSE" | jq -r '.analysis' | grep "Quant:"
elif echo "$RESPONSE" | grep -q "Options data unavailable"; then
    echo "   ⚠️  Options data still unavailable"
    echo ""
    echo "   This could mean:"
    echo "   - Render hasn't deployed the new code yet"
    echo "   - Yahoo Finance still blocking the IP"
    echo "   - Need to wait for IP cooldown (6-24 hours)"
elif echo "$RESPONSE" | grep -q "error"; then
    echo "   ❌ ERROR in response:"
    echo "$RESPONSE" | jq -r '.error, .message'
else
    echo "   ℹ️  No quant metrics in response"
    echo "   Response might be text-only or still using old code"
fi

echo ""
echo "=================================================="
echo "Test complete!"
echo "=================================================="

