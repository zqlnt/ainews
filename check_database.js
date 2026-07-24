import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Supabase credentials not configured');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkDatabase() {
  console.log('========================================');
  console.log('📊 Database Contents Summary');
  console.log('========================================\n');

  try {
    // Check conversations table
    console.log('1️⃣  Conversations Table:\n');
    const { data: conversations, error: convError } = await supabase
      .from('conversations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (convError) {
      console.log(`   ❌ Error: ${convError.message}\n`);
    } else {
      console.log(`   Total conversations: ${conversations.length} (showing last 10)`);
      if (conversations.length > 0) {
        const sample = conversations[0];
        console.log(`   Sample conversation:`);
        console.log(`   - ID: ${sample.id}`);
        console.log(`   - Created: ${sample.created_at}`);
        console.log(`   - Messages: ${sample.messages?.length || 0}`);
        console.log(`   - Last updated: ${sample.updated_at}\n`);
      } else {
        console.log(`   No conversations yet\n`);
      }
    }

    // Check metrics_history table
    console.log('2️⃣  Metrics History Table:\n');
    const { data: metrics, error: metricsError } = await supabase
      .from('metrics_history')
      .select('*')
      .order('date', { ascending: false })
      .limit(10);
    
    if (metricsError) {
      console.log(`   ❌ Error: ${metricsError.message}\n`);
    } else {
      // Get total count
      const { count: totalCount } = await supabase
        .from('metrics_history')
        .select('*', { count: 'exact', head: true });
      
      // Get unique tickers
      const { data: tickersData } = await supabase
        .from('metrics_history')
        .select('ticker')
        .order('ticker');
      
      const uniqueTickers = [...new Set(tickersData?.map(t => t.ticker) || [])].sort();
      
      // Get date range
      const { data: dateRange } = await supabase
        .from('metrics_history')
        .select('date')
        .order('date', { ascending: true })
        .limit(1);
      
      const { data: dateRangeMax } = await supabase
        .from('metrics_history')
        .select('date')
        .order('date', { ascending: false })
        .limit(1);
      
      console.log(`   Total records: ${totalCount || 0}`);
      console.log(`   Unique tickers: ${uniqueTickers.length} (${uniqueTickers.join(', ')})`);
      if (dateRange && dateRangeMax) {
        console.log(`   Date range: ${dateRange[0].date} to ${dateRangeMax[0].date}`);
      }
      
      // Count by data freshness
      const { data: freshnessData } = await supabase
        .from('metrics_history')
        .select('data_freshness');
      
      const freshnessCounts = {};
      freshnessData?.forEach(item => {
        const f = item.data_freshness || 'unknown';
        freshnessCounts[f] = (freshnessCounts[f] || 0) + 1;
      });
      
      console.log(`   Data freshness breakdown:`);
      Object.entries(freshnessCounts).forEach(([key, count]) => {
        console.log(`     - ${key}: ${count}`);
      });
      
      if (metrics && metrics.length > 0) {
        const sample = metrics[0];
        console.log(`\n   Sample record:`);
        console.log(`   - Ticker: ${sample.ticker}`);
        console.log(`   - Date: ${sample.date}`);
        console.log(`   - Spot price: ${sample.spot_price || 'N/A'}`);
        console.log(`   - Dealer Gamma: ${sample.dealer_gamma_value !== null ? sample.dealer_gamma_value : 'N/A'}`);
        console.log(`   - Skew: ${sample.skew_value !== null ? sample.skew_value : 'N/A'}`);
        console.log(`   - ATM IV: ${sample.atm_iv_value !== null ? sample.atm_iv_value : 'N/A'}`);
        console.log(`   - Data freshness: ${sample.data_freshness || 'N/A'}`);
        console.log(`   - Recorded at: ${sample.recorded_at}\n`);
      } else {
        console.log(`   No metrics yet\n`);
      }
    }

    // Get per-ticker summary
    console.log('3️⃣  Per-Ticker Summary:\n');
    const uniqueTickers = [...new Set(tickersData?.map(t => t.ticker) || [])].sort();
    if (uniqueTickers && uniqueTickers.length > 0) {
      for (const ticker of uniqueTickers.slice(0, 10)) {
        const { count } = await supabase
          .from('metrics_history')
          .select('*', { count: 'exact', head: true })
          .eq('ticker', ticker);
        
        const { data: tickerData } = await supabase
          .from('metrics_history')
          .select('date')
          .eq('ticker', ticker)
          .order('date', { ascending: false })
          .limit(1);
        
        const latestDate = tickerData && tickerData.length > 0 ? tickerData[0].date : 'N/A';
        console.log(`   ${ticker.padEnd(6)}: ${count || 0} records (latest: ${latestDate})`);
      }
      if (uniqueTickers.length > 10) {
        console.log(`   ... and ${uniqueTickers.length - 10} more tickers`);
      }
      console.log('');
    }

    console.log('='.repeat(70));
    console.log('✅ Database Check Complete');
    console.log('='.repeat(70));

    return {
      conversations: conversations?.length || 0,
      metricsTotal: totalCount || 0,
      tickers: uniqueTickers,
      dateRange: dateRange && dateRangeMax ? {
        start: dateRange[0].date,
        end: dateRangeMax[0].date
      } : null
    };

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkDatabase().catch(console.error);

