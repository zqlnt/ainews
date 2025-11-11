#!/bin/bash

echo "=========================================="
echo "Daily Metrics Logging Diagnostic"
echo "=========================================="
echo ""

echo "📅 Current Date/Time:"
echo "  UTC: $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo "  ET:  $(TZ=America/New_York date +"%Y-%m-%d %H:%M:%S %Z")"
echo ""

echo "🔍 Checking GitHub Actions workflow:"
echo "  Workflow file: .github/workflows/daily-metrics-logger.yml"
if [ -f ".github/workflows/daily-metrics-logger.yml" ]; then
  echo "  ✅ Workflow file exists"
  echo ""
  echo "  Schedule: Every weekday at 2 PM UTC (10 AM ET)"
  echo "  Next weekday run: $(date -u -d 'next Monday 14:00' +"%Y-%m-%d %H:%M:%S UTC" 2>/dev/null || echo "Unable to calculate")"
else
  echo "  ❌ Workflow file NOT found"
fi
echo ""

echo "🔍 Checking API endpoint:"
API_URL="${API_URL:-https://ainews-ybbv.onrender.com}"
echo "  API URL: $API_URL"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/stats/metrics" 2>/dev/null)
if [ "$STATUS" = "200" ]; then
  echo "  ✅ API is reachable (HTTP $STATUS)"
  echo ""
  echo "  Metrics stats:"
  curl -s "$API_URL/stats/metrics" | jq '.' 2>/dev/null || echo "    (Unable to parse JSON)"
else
  echo "  ❌ API returned HTTP $STATUS"
fi
echo ""

echo "🔍 Date logic check:"
NODE_SCRIPT=$(cat <<'EOF'
const date = new Date();
const utcDate = date.toISOString().split('T')[0];
console.log(`  Server date (UTC): ${utcDate}`);
console.log(`  Current UTC time: ${date.toISOString()}`);
EOF
)
node -e "$NODE_SCRIPT"
echo ""

echo "📊 Suggested checks:"
echo "  1. Go to GitHub Actions tab in your repo"
echo "  2. Look for 'Daily Metrics Logger' workflow runs"
echo "  3. Check if runs happened on Nov 1 (Friday) at 2 PM UTC"
echo "  4. Check workflow logs for any errors"
echo "  5. Verify Supabase credentials are set in Render environment"
echo ""


