import fetch from 'node-fetch';

const API_URL = 'https://ainews-ybbv.onrender.com';

async function testDeployment() {
  console.log('========================================');
  console.log('🧪 Testing Production Deployment');
  console.log('========================================\n');
  
  // 1. Health check
  console.log('1️⃣  Health Check...');
  try {
    const health = await fetch(API_URL);
    const healthData = await health.json();
    console.log(`   ✅ API is running`);
    console.log(`   Status: ${healthData.status}`);
    console.log(`   Version: ${healthData.version || 'N/A'}`);
    console.log(`   Message: ${healthData.message}\n`);
  } catch (error) {
    console.log(`   ❌ Health check failed: ${error.message}\n`);
    return;
  }
  
  // 2. Test pattern analysis with SPY
  console.log('2️⃣  Testing Enhanced Pattern Analysis...');
  console.log('   Query: SPY\n');
  
  try {
    const startTime = Date.now();
    const response = await fetch(`${API_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'SPY',
        news: ''
      })
    });
    
    const elapsed = Date.now() - startTime;
    
    if (!response.ok) {
      console.log(`   ❌ HTTP ${response.status}`);
      const errorText = await response.text();
      console.log(`   Error: ${errorText.substring(0, 200)}\n`);
      return;
    }
    
    const analysis = await response.json();
    
    if (!analysis.success) {
      console.log(`   ❌ Analysis failed: ${analysis.error || 'Unknown error'}\n`);
      return;
    }
    
    console.log(`   ✅ Analysis completed (${elapsed}ms)\n`);
    
    const text = analysis.analysis || '';
    
    // Check for enhanced features
    console.log('3️⃣  Checking Enhanced Features...\n');
    
    const features = {
      'Pattern Analysis Section': 
        text.includes('PATTERN ANALYSIS') || 
        text.includes('HISTORICAL CONTEXT') ||
        text.includes('Pattern'),
      
      'Trend Information': 
        text.includes('Trend:') ||
        text.includes('increasing') ||
        text.includes('decreasing') ||
        text.includes('stable'),
      
      'Statistical Measures': 
        text.includes('percentile') ||
        text.includes('z-score') ||
        text.includes('MAD') ||
        text.includes('median') ||
        text.includes('regime'),
      
      'Provenance Info': 
        text.includes('samples') ||
        text.includes('provenance') ||
        text.includes('data age') ||
        text.includes('d old'),
      
      'Correlation Analysis': 
        text.includes('correlation') ||
        text.includes('relationship'),
      
      'Factual Language (No Predictions)': 
        (text.includes('has been') || text.includes('currently') || text.includes('historical')) &&
        !text.includes('will likely') &&
        !text.includes('should predict')
    };
    
    let foundCount = 0;
    for (const [feature, found] of Object.entries(features)) {
      const status = found ? '✅' : '⚠️';
      console.log(`   ${status} ${feature}`);
      if (found) foundCount++;
    }
    
    console.log(`\n   Features Found: ${foundCount}/${Object.keys(features).length}\n`);
    
    // Show relevant sections
    const lines = text.split('\n');
    const patternIndex = lines.findIndex(l => 
      l.includes('PATTERN ANALYSIS') || 
      l.includes('HISTORICAL CONTEXT')
    );
    
    if (patternIndex >= 0) {
      console.log('4️⃣  Pattern Analysis Section Preview:\n');
      console.log('   ' + '─'.repeat(70));
      const section = lines.slice(patternIndex, patternIndex + 15);
      section.forEach(line => {
        if (line.trim()) {
          console.log(`   ${line.substring(0, 70)}`);
        }
      });
      console.log('   ' + '─'.repeat(70));
    } else {
      console.log('4️⃣  Pattern Analysis Section:\n');
      console.log('   ⚠️  Not found in response');
      console.log('   (This could mean: insufficient data, old code, or data not available)\n');
    }
    
    // Check if it's using old or new code
    const hasOldFormat = text.includes('vs 7-day avg') && !text.includes('Pattern');
    const hasNewFormat = text.includes('PATTERN ANALYSIS') || text.includes('Trend:') && text.includes('method:');
    
    console.log('5️⃣  Code Version Detection:\n');
    if (hasNewFormat) {
      console.log('   ✅ NEW CODE DETECTED - Enhanced pattern analysis is active!');
    } else if (hasOldFormat) {
      console.log('   ⚠️  OLD CODE DETECTED - Simple averages only');
      console.log('   → Deployment may not have updated yet');
    } else {
      console.log('   ❓ UNCLEAR - Cannot determine version');
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ Deployment Test Complete');
    console.log('='.repeat(70));
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}\n`);
  }
}

testDeployment().catch(console.error);

