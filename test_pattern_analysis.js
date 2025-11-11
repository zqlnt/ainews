import dotenv from 'dotenv';
dotenv.config();

import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'https://ainews-ybbv.onrender.com';

async function testPatternAnalysis() {
  console.log('========================================');
  console.log('🧪 Testing Enhanced Pattern Analysis');
  console.log('========================================\n');
  
  const testTickers = ['SPY', 'QQQ', 'AAPL'];
  let passed = 0;
  let failed = 0;
  
  for (const ticker of testTickers) {
    console.log(`\n📊 Testing ${ticker}...`);
    console.log('─'.repeat(60));
    
    try {
      const startTime = Date.now();
      const response = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: ticker,
          news: ''
        })
      });
      
      const elapsed = Date.now() - startTime;
      
      if (!response.ok) {
        console.log(`  ❌ HTTP ${response.status}`);
        failed++;
        continue;
      }
      
      const analysis = await response.json();
      
      if (!analysis.success) {
        console.log(`  ❌ Analysis failed: ${analysis.error || 'Unknown error'}`);
        failed++;
        continue;
      }
      
      console.log(`  ✅ Analysis completed (${elapsed}ms)`);
      
      const text = analysis.analysis || '';
      
      // Check for enhanced pattern keywords
      const checks = {
        'Pattern analysis present': 
          text.includes('PATTERN ANALYSIS') || 
          text.includes('Pattern') ||
          text.includes('Trend:') ||
          text.includes('percentile'),
        
        'Provenance info': 
          text.includes('samples') ||
          text.includes('provenance') ||
          text.includes('data age') ||
          text.includes('d old'),
        
        'Statistical measures': 
          text.includes('z-score') ||
          text.includes('MAD') ||
          text.includes('median') ||
          text.includes('regime'),
        
        'No hallucinations': 
          !text.includes('will likely') &&
          !text.includes('should') &&
          !text.includes('predict') &&
          !text.includes('forecast'),
        
        'Factual language': 
          text.includes('has been') ||
          text.includes('currently') ||
          text.includes('historical') ||
          text.includes('over the past')
      };
      
      let checksPassed = 0;
      for (const [check, result] of Object.entries(checks)) {
        const status = result ? '✅' : '⚠️';
        console.log(`  ${status} ${check}`);
        if (result) checksPassed++;
      }
      
      // Show a snippet
      const lines = text.split('\n');
      const patternSection = lines.findIndex(l => 
        l.includes('PATTERN ANALYSIS') || 
        l.includes('HISTORICAL CONTEXT') ||
        l.includes('Pattern')
      );
      
      if (patternSection >= 0) {
        console.log(`\n  📝 Pattern Section Preview:`);
        lines.slice(patternSection, patternSection + 5).forEach(line => {
          if (line.trim()) {
            console.log(`     ${line.substring(0, 70)}`);
          }
        });
      }
      
      if (checksPassed >= 3) {
        passed++;
      } else {
        failed++;
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Tests Passed: ${passed}/${testTickers.length}`);
  console.log(`❌ Tests Failed: ${failed}/${testTickers.length}`);
  console.log('='.repeat(60));
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! Enhanced pattern analysis is working.');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above for details.');
  }
}

testPatternAnalysis().catch(console.error);

