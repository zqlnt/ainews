/**
 * Conversation Memory Store
 * 
 * Manages conversation sessions in Supabase for follow-up questions
 * - Stores conversation history
 * - Tracks last ticker per conversation
 * - Auto-expires after 30 minutes of inactivity
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

let supabase = null;

/**
 * Initialize Supabase client
 */
function getSupabaseClient() {
  if (!supabase && SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabase;
}

/**
 * Check if conversation memory is enabled
 */
export function isConversationMemoryEnabled() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Get or create a conversation
 * 
 * @param {string} conversationId - Unique conversation ID
 * @returns {Promise<{ticker: string|null, messages: Array}>}
 */
export async function getConversation(conversationId) {
  if (!isConversationMemoryEnabled()) {
    return { ticker: null, messages: [] };
  }

  try {
    const client = getSupabaseClient();
    
    const { data, error } = await client
      .from('conversations')
      .select('ticker, messages')
      .eq('conversation_id', conversationId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = not found
      console.error('[ConversationStore] Error fetching conversation:', error);
      return { ticker: null, messages: [] };
    }

    if (!data) {
      // Conversation doesn't exist, return empty
      return { ticker: null, messages: [] };
    }

    return {
      ticker: data.ticker,
      messages: data.messages || []
    };
  } catch (err) {
    console.error('[ConversationStore] Exception fetching conversation:', err);
    return { ticker: null, messages: [] };
  }
}

/**
 * Save conversation state
 * 
 * @param {string} conversationId - Unique conversation ID
 * @param {string|null} ticker - Current ticker symbol
 * @param {Array} messages - Conversation messages [{role, content}]
 * @returns {Promise<boolean>} Success status
 */
export async function saveConversation(conversationId, ticker, messages) {
  if (!isConversationMemoryEnabled()) {
    return false;
  }

  try {
    const client = getSupabaseClient();
    
    // Keep only last 10 messages to avoid token bloat
    const trimmedMessages = messages.slice(-10);
    
    const { error } = await client
      .from('conversations')
      .upsert({
        conversation_id: conversationId,
        ticker: ticker,
        messages: trimmedMessages,
        last_active: new Date().toISOString()
      }, {
        onConflict: 'conversation_id'
      });

    if (error) {
      console.error('[ConversationStore] Error saving conversation:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[ConversationStore] Exception saving conversation:', err);
    return false;
  }
}

/**
 * Extract ticker from query or use conversation context
 * 
 * @param {string} query - User query
 * @param {string|null} contextTicker - Ticker from conversation history
 * @returns {string|null} Extracted or context ticker
 */
export function resolveTickerWithContext(query, contextTicker) {
  // Try to extract ticker from query first
  const tickerPattern = /\b([A-Z]{1,5})\b/g;
  const matches = query.match(tickerPattern);
  
  if (matches) {
    // Common words that might be mistaken for tickers
    const excludeWords = ['I', 'A', 'AND', 'OR', 'THE', 'IS', 'IT', 'AT', 'TO', 'FOR'];
    const validTickers = matches.filter(m => !excludeWords.includes(m));
    
    if (validTickers.length > 0) {
      return validTickers[0]; // Return first valid ticker
    }
  }
  
  // No ticker in query, use context
  return contextTicker;
}

/**
 * Cleanup old conversations (run periodically)
 * Removes conversations inactive for > 30 minutes
 * 
 * @returns {Promise<number>} Number of conversations deleted
 */
export async function cleanupOldConversations() {
  if (!isConversationMemoryEnabled()) {
    return 0;
  }

  try {
    const client = getSupabaseClient();
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    const { data, error } = await client
      .from('conversations')
      .delete()
      .lt('last_active', thirtyMinutesAgo)
      .select();

    if (error) {
      console.error('[ConversationStore] Error cleaning up conversations:', error);
      return 0;
    }

    const count = data?.length || 0;
    if (count > 0) {
      console.log(`[ConversationStore] Cleaned up ${count} old conversations`);
    }
    
    return count;
  } catch (err) {
    console.error('[ConversationStore] Exception cleaning up conversations:', err);
    return 0;
  }
}

/**
 * Get conversation statistics
 * 
 * @returns {Promise<{total: number, active: number}>}
 */
export async function getConversationStats() {
  if (!isConversationMemoryEnabled()) {
    return { total: 0, active: 0 };
  }

  try {
    const client = getSupabaseClient();
    
    // Total conversations
    const { count: total } = await client
      .from('conversations')
      .select('*', { count: 'exact', head: true });
    
    // Active conversations (< 30 min old)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { count: active } = await client
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .gte('last_active', thirtyMinutesAgo);
    
    return { 
      total: total || 0, 
      active: active || 0 
    };
  } catch (err) {
    console.error('[ConversationStore] Exception getting stats:', err);
    return { total: 0, active: 0 };
  }
}

