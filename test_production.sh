#!/bin/bash

# Production Testing Script for ainews API
# Tests both old features and new sentiment features

API_URL="https://ainews-ybbv.onrender.com"

echo "🧪 Testing Production Deployment: $API_URL"
echo "================================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

test_endpoint() {
    local name="$1"
    local url="$2"
    local expected="$3"
    
    echo -n "Testing $name... "
    response=$(curl -s "$url")
    
    if echo "$response" | grep -q "$expected"; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((pass_count++))
        return 0
    else
        echo -e "${RED}❌ FAIL${NC}"
        echo "  Expected: $expected"
        echo "  Got: $response" | head -c 200
        echo ""
        ((fail_count++))
        return 1
    fi
}

echo "📋 OLD FEATURES (Must Still Work)"
echo "--------------------------------"

# Test 1: Health Check
test_endpoint "Health check" \
    "$API_URL/" \
    '"status":"ok"'

# Test 2: Claude API Test
test_endpoint "Claude API connection" \
    "$API_URL/test/claude" \
    '"success":true'

# Test 3: Finnhub API Test
test_endpoint "Finnhub API connection" \
    "$API_URL/test/finnhub" \
    '"success":true'

# Test 4: Alpaca API Test
test_endpoint "Alpaca API connection" \
    "$API_URL/test/alpaca" \
    '"success":true'

# Test 5: Options Test
test_endpoint "Options data (yfinance)" \
    "$API_URL/test/options" \
    '"success":true'

# Test 6: Old News Endpoint
test_endpoint "Old /news/AAPL endpoint" \
    "$API_URL/news/AAPL" \
    '"symbol":"AAPL"'

# Test 7: Analyze Endpoint (most important!)
echo -n "Testing /analyze endpoint... "
analyze_response=$(curl -s "$API_URL/analyze" \
    -H "Content-Type: application/json" \
    -d '{"query": "What is the outlook for AAPL?", "news": "Apple reports strong iPhone sales"}')

if echo "$analyze_response" | grep -q '"success":true' && \
   echo "$analyze_response" | grep -q '"analysis"'; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    echo "  Response: $analyze_response" | head -c 200
    ((fail_count++))
fi

# Test 8: Analysis V2 Schema
echo -n "Testing analysis_v2 schema... "
if echo "$analyze_response" | grep -q '"analysis_v2"' && \
   echo "$analyze_response" | grep -q '"schema_version"'; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

echo ""
echo "🆕 NEW FEATURES (Sentiment)"
echo "--------------------------------"

# Test 9: News Blocks Endpoint
test_endpoint "News blocks endpoint" \
    "$API_URL/newsfeed/blocks?limit=5" \
    '"status"'

# Test 10: Sentiment Fields Present
echo -n "Testing sentiment fields in news... "
news_response=$(curl -s "$API_URL/newsfeed/blocks?limit=3")
if echo "$news_response" | grep -q '"sentiment"' && \
   echo "$news_response" | grep -q '"sentiment_source"'; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    echo "  Response: $news_response" | head -c 200
    ((fail_count++))
fi

# Test 11: Sentiment Filter - Bullish
test_endpoint "Sentiment filter: bullish" \
    "$API_URL/newsfeed/blocks?sentiment=bullish&limit=3" \
    '"sentiment":"bullish"'

# Test 12: Sentiment Filter - Bearish
test_endpoint "Sentiment filter: bearish" \
    "$API_URL/newsfeed/blocks?sentiment=bearish&limit=3" \
    '"status"'

# Test 13: Sentiment Filter - Neutral
test_endpoint "Sentiment filter: neutral" \
    "$API_URL/newsfeed/blocks?sentiment=neutral&limit=3" \
    '"status"'

# Test 14: Symbol News with Sentiment
test_endpoint "Symbol news with sentiment" \
    "$API_URL/newsfeed/AAPL?limit=5" \
    '"symbol":"AAPL"'

# Test 15: Image Proxy
test_endpoint "Image proxy endpoint" \
    "$API_URL/img?src=https://via.placeholder.com/150" \
    "PNG\|GIF\|JPEG"

echo ""
echo "================================================"
echo "📊 Test Results"
echo "================================================"
echo -e "${GREEN}Passed: $pass_count${NC}"
echo -e "${RED}Failed: $fail_count${NC}"
echo ""

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! Production is ready.${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed. Check the output above.${NC}"
    exit 1
fi

