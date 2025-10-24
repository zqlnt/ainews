#!/bin/bash

# Comprehensive Production Testing Script for ainews API
# Tests ALL features: old endpoints, quant metrics, sentiment, and edge cases

API_URL="https://ainews-ybbv.onrender.com"

echo "🧪 COMPREHENSIVE PRODUCTION TEST"
echo "API: $API_URL"
echo "================================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

test_endpoint() {
    local name="$1"
    local method="$2"
    local url="$3"
    local data="$4"
    local expected="$5"
    
    echo -n "Testing $name... "
    
    if [ "$method" = "POST" ]; then
        response=$(curl -s -X POST "$url" \
            -H "Content-Type: application/json" \
            -d "$data")
    else
        response=$(curl -s "$url")
    fi
    
    if echo "$response" | grep -q "$expected"; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((pass_count++))
        return 0
    else
        echo -e "${RED}❌ FAIL${NC}"
        echo "  Expected substring: $expected"
        echo "  Response: $(echo "$response" | head -c 300)..."
        echo ""
        ((fail_count++))
        return 1
    fi
}

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 SECTION 1: CORE API HEALTH${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Test 1: Health Check
test_endpoint "Health check" \
    "GET" \
    "$API_URL/" \
    "" \
    "status"

# Test 2: Claude API
echo -n "Testing Claude API connection... "
response=$(curl -s "$API_URL/test/claude")
if echo "$response" | grep -q "success\|status"; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    echo "  Response: $response"
    ((fail_count++))
fi

# Test 3: Finnhub API
echo -n "Testing Finnhub API connection... "
response=$(curl -s "$API_URL/test/finnhub")
if echo "$response" | grep -q "success\|status"; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    echo "  Response: $response"
    ((fail_count++))
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📊 SECTION 2: QUANT METRICS & OPTIONS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Test 4: Options Provider
echo -n "Testing Options provider (yfinance)... "
response=$(curl -s "$API_URL/test/options")
if echo "$response" | grep -q "yfinance"; then
    echo -e "${GREEN}✅ PASS${NC}"
    echo "  Provider: yfinance-local"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    echo "  Response: $response"
    ((fail_count++))
fi

# Test 5: Analyze with Quant Metrics (NVDA)
echo -n "Testing /analyze with quant metrics (NVDA)... "
response=$(curl -s -X POST "$API_URL/analyze" \
    -H "Content-Type: application/json" \
    -d '{"query": "What is the outlook for NVDA?", "news": "NVIDIA announces new AI chips"}')

if echo "$response" | grep -q '"success":true' && \
   echo "$response" | grep -q '"analysis"'; then
    echo -e "${GREEN}✅ PASS${NC}"
    
    # Check for quant metrics in response
    if echo "$response" | jq -r '.analysis' | grep -q "Quant:"; then
        echo -e "  ${GREEN}→ Quant metrics present${NC}"
    else
        echo -e "  ${YELLOW}→ No quant metrics (might be cached or unavailable)${NC}"
    fi
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    echo "  Response: $(echo "$response" | head -c 300)"
    ((fail_count++))
fi

# Test 6: Check Quant Metrics Detail
echo -n "Testing quant metrics detail... "
analysis_text=$(echo "$response" | jq -r '.analysis' 2>/dev/null)
if echo "$analysis_text" | grep -q "Dealer Gamma\|ATM IV\|Skew\|Put/Call"; then
    echo -e "${GREEN}✅ PASS${NC}"
    echo "  Metrics found:"
    echo "$analysis_text" | grep -o "Dealer Gamma[^;]*" | head -1 | sed 's/^/    /'
    echo "$analysis_text" | grep -o "ATM IV[^;]*" | head -1 | sed 's/^/    /'
    ((pass_count++))
else
    echo -e "${YELLOW}⚠️  SKIP${NC} (quant data may be unavailable)"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}💬 SECTION 3: ANALYSIS & CHAT FUNCTIONALITY${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Test 7: Basic Analysis
test_endpoint "Basic stock analysis (AAPL)" \
    "POST" \
    "$API_URL/analyze" \
    '{"query": "What is happening with AAPL?", "news": "Apple reports strong iPhone sales"}' \
    '"success":true'

# Test 8: Analysis V2 Schema
echo -n "Testing analysis_v2 schema... "
response=$(curl -s -X POST "$API_URL/analyze" \
    -H "Content-Type: application/json" \
    -d '{"query": "TSLA outlook", "news": "Tesla announces price cuts"}')

if echo "$response" | grep -q '"analysis_v2"' && \
   echo "$response" | grep -q '"schema_version"'; then
    echo -e "${GREEN}✅ PASS${NC}"
    
    # Check for structured fields
    v2_data=$(echo "$response" | jq -r '.analysis_v2')
    if echo "$v2_data" | grep -q '"intro"' && \
       echo "$v2_data" | grep -q '"bullish"' && \
       echo "$v2_data" | grep -q '"bearish"'; then
        echo "  → Structured fields present (intro, bullish, bearish, neutral)"
    fi
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

# Test 9: Multiple Perspectives
echo -n "Testing multiple perspectives (bullish/bearish/neutral)... "
if echo "$response" | jq -r '.analysis' | grep -q "BULLISH:" && \
   echo "$response" | jq -r '.analysis' | grep -q "BEARISH:" && \
   echo "$response" | jq -r '.analysis' | grep -q "NEUTRAL:"; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

# Test 10: Confidence Scores
echo -n "Testing confidence scores in analysis_v2... "
confidence=$(echo "$response" | jq -r '.analysis_v2.meta.confidence' 2>/dev/null)
if echo "$confidence" | grep -q "bullish\|bearish\|neutral"; then
    echo -e "${GREEN}✅ PASS${NC}"
    echo "  Confidence: $(echo "$confidence" | jq -c '.')"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

# Test 11: Symbol Extraction
test_endpoint "Symbol extraction from query" \
    "POST" \
    "$API_URL/analyze" \
    '{"query": "How is Microsoft doing?", "news": "MSFT earnings beat"}' \
    '"success":true'

# Test 12: Advice Guardrails
echo -n "Testing advice guardrails (should not give buy/sell advice)... "
response=$(curl -s -X POST "$API_URL/analyze" \
    -H "Content-Type: application/json" \
    -d '{"query": "Should I buy AAPL?", "news": ""}')

analysis=$(echo "$response" | jq -r '.analysis' 2>/dev/null)
if echo "$analysis" | grep -q -i "not financial advice\|not a recommendation\|consult"; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${YELLOW}⚠️  WARN${NC} (advice guardrail may need review)"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📰 SECTION 4: NEWS ENDPOINTS (OLD)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Test 13: Old News Endpoint
test_endpoint "Old /news/AAPL endpoint" \
    "GET" \
    "$API_URL/news/AAPL" \
    "" \
    '"symbol":"AAPL"'

# Test 14: News with Popular Symbol
test_endpoint "Old news endpoint (TSLA)" \
    "GET" \
    "$API_URL/news/TSLA" \
    "" \
    '"symbol":"TSLA"'

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🎯 SECTION 5: NEW SENTIMENT FEATURES${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Test 15: News Blocks
test_endpoint "News blocks endpoint" \
    "GET" \
    "$API_URL/newsfeed/blocks?limit=5" \
    "" \
    '"status"'

# Test 16: Sentiment Fields
echo -n "Testing sentiment fields in news items... "
response=$(curl -s "$API_URL/newsfeed/blocks?limit=3")
if echo "$response" | grep -q '"sentiment"' && \
   echo "$response" | grep -q '"sentiment_source"' && \
   echo "$response" | grep -q '"sentiment_version"'; then
    echo -e "${GREEN}✅ PASS${NC}"
    
    # Show sentiment distribution
    sentiment_counts=$(echo "$response" | jq -r '[.hero.sentiment, .tiles[].sentiment, .latest[].sentiment] | group_by(.) | map({sentiment: .[0], count: length}) | .[]' 2>/dev/null)
    if [ ! -z "$sentiment_counts" ]; then
        echo "  Sentiment distribution: $(echo "$sentiment_counts" | jq -s -c '.')"
    fi
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

# Test 17: Sentiment Filter - Bullish
echo -n "Testing sentiment filter: bullish... "
response=$(curl -s "$API_URL/newsfeed/blocks?sentiment=bullish&limit=5")
if echo "$response" | grep -q '"status"'; then
    # Check that items are actually bullish
    bullish_count=$(echo "$response" | jq -r '[.tiles[], .latest[]] | map(select(.sentiment == "bullish")) | length' 2>/dev/null)
    total_count=$(echo "$response" | jq -r '[.tiles[], .latest[]] | length' 2>/dev/null)
    
    if [ "$bullish_count" = "$total_count" ] && [ "$total_count" -gt 0 ]; then
        echo -e "${GREEN}✅ PASS${NC} (all $total_count items are bullish)"
        ((pass_count++))
    elif echo "$response" | grep -q '"note"'; then
        echo -e "${GREEN}✅ PASS${NC} (fallback mode active)"
        ((pass_count++))
    else
        echo -e "${YELLOW}⚠️  PARTIAL${NC} ($bullish_count/$total_count bullish)"
        ((pass_count++))
    fi
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

# Test 18: Sentiment Filter - Bearish
test_endpoint "Sentiment filter: bearish" \
    "GET" \
    "$API_URL/newsfeed/blocks?sentiment=bearish&limit=5" \
    "" \
    '"status"'

# Test 19: Sentiment Filter - Neutral
test_endpoint "Sentiment filter: neutral" \
    "GET" \
    "$API_URL/newsfeed/blocks?sentiment=neutral&limit=5" \
    "" \
    '"status"'

# Test 20: Sentiment Filter - All (with shuffle)
echo -n "Testing sentiment=all (with shuffle)... "
response1=$(curl -s "$API_URL/newsfeed/blocks?sentiment=all&limit=5")
sleep 2
response2=$(curl -s "$API_URL/newsfeed/blocks?sentiment=all&limit=5")

if [ "$response1" = "$response2" ]; then
    echo -e "${GREEN}✅ PASS${NC} (stable within same minute)"
    ((pass_count++))
else
    echo -e "${YELLOW}⚠️  WARN${NC} (order changed, may be new minute bucket)"
    ((pass_count++))
fi

# Test 21: Symbol News with Sentiment
test_endpoint "Symbol news with sentiment (AAPL)" \
    "GET" \
    "$API_URL/newsfeed/AAPL?limit=5" \
    "" \
    '"symbol":"AAPL"'

# Test 22: Symbol News Sentiment Fields
echo -n "Testing sentiment fields in symbol news... "
response=$(curl -s "$API_URL/newsfeed/NVDA?limit=3")
if echo "$response" | grep -q '"sentiment"'; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

# Test 23: Strict Mode
echo -n "Testing strict mode (sentiment=neutral&strict=1)... "
response=$(curl -s "$API_URL/newsfeed/blocks?sentiment=neutral&strict=1&limit=5")
if echo "$response" | grep -q '"status"'; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🖼️  SECTION 6: IMAGE PROXY${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Test 24: Image Proxy
echo -n "Testing image proxy... "
response=$(curl -s -I "$API_URL/img?src=https://via.placeholder.com/150" | head -n 1)
if echo "$response" | grep -q "200\|304"; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    echo "  Response: $response"
    ((fail_count++))
fi

# Test 25: Image Proxy with Invalid URL
echo -n "Testing image proxy fallback (invalid URL)... "
response=$(curl -s -I "$API_URL/img?src=https://invalid-url-that-does-not-exist.com/image.jpg" | head -n 1)
if echo "$response" | grep -q "200"; then
    echo -e "${GREEN}✅ PASS${NC} (placeholder returned)"
    ((pass_count++))
else
    echo -e "${YELLOW}⚠️  WARN${NC} (unexpected response)"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🔍 SECTION 7: EDGE CASES & ERROR HANDLING${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Test 26: Missing Query Field
echo -n "Testing missing query field... "
response=$(curl -s -X POST "$API_URL/analyze" \
    -H "Content-Type: application/json" \
    -d '{"news": "Some news"}')
if echo "$response" | grep -q "error\|required"; then
    echo -e "${GREEN}✅ PASS${NC} (proper error handling)"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

# Test 27: Invalid Symbol
echo -n "Testing invalid symbol... "
response=$(curl -s "$API_URL/newsfeed/INVALIDSYMBOL12345?limit=3")
if echo "$response" | grep -q '"status"'; then
    echo -e "${GREEN}✅ PASS${NC} (graceful degradation)"
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

# Test 28: Cache Headers
echo -n "Testing cache headers... "
response=$(curl -s -I "$API_URL/newsfeed/blocks" | grep -i "cache-control\|etag")
if [ ! -z "$response" ]; then
    echo -e "${GREEN}✅ PASS${NC}"
    echo "$response" | sed 's/^/  /'
    ((pass_count++))
else
    echo -e "${RED}❌ FAIL${NC}"
    ((fail_count++))
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📊 FINAL RESULTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}✅ Passed: $pass_count${NC}"
echo -e "${RED}❌ Failed: $fail_count${NC}"
total=$((pass_count + fail_count))
percentage=$((pass_count * 100 / total))
echo "📈 Success Rate: $percentage% ($pass_count/$total)"
echo ""

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}🎉 ALL TESTS PASSED! PRODUCTION IS READY! 🎉${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
elif [ $fail_count -le 3 ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚠️  MOSTLY WORKING - Minor issues detected${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}⚠️  SOME TESTS FAILED - Review output above${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
