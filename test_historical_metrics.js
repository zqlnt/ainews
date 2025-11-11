/**
 * Test Historical Metrics Integration
 * 
 * Tests if the /analyze endpoint fetches and uses historical metrics
 * from Supabase metrics_history table in its analysis.
 */

import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://localhost:3000';

async function testHistoricalMetrics() {
  console.log('========================================');
  console.log('🧪 Testing Historical Metrics Integration');
  console.log('========================================');
  console.log(`API URL: ${API_URL}`);
  console.log('');

  // Step 1: Check if metrics logging is enabled
  console.log('Step 1: Checking metrics logging status...');
  try {
    const statsResponse = await fetch(`${API_URL}/stats/metrics`);
    const stats = await statsResponse.json();
    
    if (!stats.enabled) {
      console.log('❌ Metrics logging is NOT enabled');
      console.log('   Reason:', stats.message || 'Unknown');
      console.log('');
      console.log('⚠️  Historical metrics will NOT be used in analysis');
      console.log('   To enable: Set SUPABASE_URL and SUPABASE_ANON_KEY');
      return;
    }
    
    console.log('✅ Metrics logging is enabled');
    console.log(`   Total snapshots: ${stats.total_snapshots}`);
    console.log(`   Unique tickers: ${stats.unique_tickers}`);
    console.log(`   Date range: ${stats.date_range?.start} to ${stats.date_range?.end}`);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to check metrics stats:', error.message);
    return;
  }

  // Step 2: Check historical data for a specific ticker
  console.log('Step 2: Checking historical data availability...');
  const testTicker = 'AAPL'; // Use a ticker that's likely in the database
  
  try {
    const historyResponse = await fetch(`${API_URL}/history/${testTicker}?days=7`);
    const history = await historyResponse.json();
    
    if (!history.enabled) {
      console.log('❌ Historical metrics endpoint returned disabled');
      return;
    }
    
    console.log(`✅ Found ${history.snapshots} historical snapshots for ${testTicker}`);
    if (history.snapshots > 0) {
      console.log(`   Date range: ${history.data?.[0]?.date} to ${history.data?.[history.data.length - 1]?.date}`);
      console.log(`   Sample metrics from most recent:`);
      const latest = history.data?.[0];
      if (latest) {
        console.log(`     - Dealer Gamma: ${latest.dealer_gamma_value || 'N/A'}`);
        console.log(`     - Skew: ${latest.skew_value || 'N/A'}`);
        console.log(`     - ATM IV: ${latest.atm_iv_value || 'N/A'}%`);
      }
    } else {
      console.log('⚠️  No historical data found for this ticker');
      console.log('   Historical metrics will NOT be included in analysis');
    }
    console.log('');
  } catch (error) {
    console.error('❌ Failed to check historical data:', error.message);
    return;
  }

  // Step 3: Make an analysis request and check logs/prompt
  console.log('Step 3: Testing /analyze endpoint with historical metrics...');
  console.log(`   Querying: ${testTicker}`);
  console.log('');
  
  try {
    const analyzeResponse = await fetch(`${API_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: testTicker,
        news: ''
      })
    });

    if (!analyzeResponse.ok) {
      console.error(`❌ Analysis request failed: HTTP ${analyzeResponse.status}`);
      const errorText = await analyzeResponse.text();
      console.error('   Response:', errorText);
      return;
    }

    const analysis = await analyzeResponse.json();
    
    console.log('✅ Analysis completed successfully');
    console.log('');
    
    // Check if analysis includes any mention of historical context
    const analysisText = analysis.analysis || '';
    const hasHistoricalMention = 
      analysisText.toLowerCase().includes('7-day') ||
      analysisText.toLowerCase().includes('average') ||
      analysisText.toLowerCase().includes('historical') ||
      analysisText.toLowerCase().includes('trend') ||
      analysisText.toLowerCase().includes('vs');
    
    if (hasHistoricalMention) {
      console.log('✅ Analysis appears to include historical context');
      console.log('   (Found keywords: 7-day, average, historical, trend, vs)');
    } else {
      console.log('⚠️  Analysis may not include historical context');
      console.log('   (No historical keywords found in output)');
      console.log('   Note: This could be normal if:');
      console.log('     - No historical data exists for this ticker');
      console.log('     - Historical metrics are used but not explicitly mentioned');
      console.log('     - AI chose not to reference historical data in response');
    }
    
    console.log('');
    console.log('📝 Analysis Preview (first 500 chars):');
    console.log('─'.repeat(60));
    console.log(analysisText.substring(0, 500) + (analysisText.length > 500 ? '...' : ''));
    console.log('─'.repeat(60));
    console.log('');
    
    // Check server logs would show "Loaded X days of historical metrics"
    console.log('📊 Server Logs:');
    console.log('   Look for this message in server logs:');
    console.log('   "📊 Loaded X days of historical metrics for trend analysis"');
    console.log('');
    
  } catch (error) {
    console.error('❌ Failed to test analysis:', error.message);
    return;
  }

  console.log('========================================');
  console.log('✅ Test Complete');
  console.log('========================================');
  console.log('');
  console.log('💡 Next Steps:');
  console.log('   1. Check server logs for historical metrics loading');
  console.log('   2. Verify Supabase has data from Oct 29-31');
  console.log('   3. Query a ticker that has historical data');
  console.log('   4. Look for historical context in the analysis');
}

// Run test
testHistoricalMetrics().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


