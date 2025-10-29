-- ============================================
-- AI News Stock Analysis - Supabase Schema
-- ============================================

-- Table 1: Conversations (for session memory)
-- Stores user sessions, last ticker, and conversation history
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id TEXT UNIQUE NOT NULL,
  ticker TEXT,
  messages JSONB DEFAULT '[]'::jsonb,
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_conversations_conversation_id ON conversations(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_active ON conversations(last_active);

-- Automatically delete conversations inactive for > 30 minutes
-- Run this as a Supabase cron job or periodically
-- DELETE FROM conversations WHERE last_active < NOW() - INTERVAL '30 minutes';

-- Table 2: Metrics History (for historical data logging)
-- Stores daily snapshots of all 14 quant metrics per ticker
CREATE TABLE IF NOT EXISTS metrics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker TEXT NOT NULL,
  spot_price NUMERIC,
  price_change NUMERIC,
  price_change_pct NUMERIC,
  
  -- Quant metrics
  dealer_gamma_value NUMERIC,
  dealer_gamma_direction TEXT, -- 'long' or 'short'
  
  skew_value NUMERIC,
  
  atm_iv_value NUMERIC,
  atm_iv_strike NUMERIC,
  
  put_call_volume_ratio NUMERIC,
  
  implied_move_dollars NUMERIC,
  implied_move_pct NUMERIC,
  
  max_pain NUMERIC,
  
  put_call_oi_ratio NUMERIC,
  
  total_delta_value NUMERIC,
  
  gamma_walls JSONB, -- Array of {strike, gamma_notional}
  
  iv_term_front NUMERIC,
  iv_term_back NUMERIC,
  
  zero_gamma_level NUMERIC,
  
  multiple_expected_moves JSONB, -- Array of {dte, move_dollars, move_pct}
  
  total_vega_value NUMERIC,
  
  vanna_value NUMERIC,
  
  -- Metadata
  data_freshness TEXT, -- 'fresh', 'stale', or 'unavailable'
  cached_minutes_ago INTEGER,
  
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  date DATE DEFAULT CURRENT_DATE
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_metrics_ticker ON metrics_history(ticker);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON metrics_history(date);
CREATE INDEX IF NOT EXISTS idx_metrics_ticker_date ON metrics_history(ticker, date);

-- Ensure one snapshot per ticker per day (optional - prevents duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_unique_ticker_date 
  ON metrics_history(ticker, date);

-- ============================================
-- Row Level Security (RLS) - Optional
-- ============================================

-- Enable RLS on tables (recommended for production)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_history ENABLE ROW LEVEL SECURITY;

-- Allow anonymous users to read/write (using anon key)
CREATE POLICY "Allow all access for anon users on conversations"
  ON conversations FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all access for anon users on metrics_history"
  ON metrics_history FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- Useful Queries
-- ============================================

-- Get conversation by ID
-- SELECT * FROM conversations WHERE conversation_id = 'xxx';

-- Get metrics history for a ticker
-- SELECT * FROM metrics_history WHERE ticker = 'AAPL' ORDER BY date DESC LIMIT 30;

-- Get metrics for all tickers on a specific date
-- SELECT * FROM metrics_history WHERE date = '2025-10-29';

-- Count active conversations
-- SELECT COUNT(*) FROM conversations WHERE last_active > NOW() - INTERVAL '30 minutes';

-- Cleanup old conversations (run as cron)
-- DELETE FROM conversations WHERE last_active < NOW() - INTERVAL '30 minutes';

