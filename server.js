import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Enable CORS for all origins
app.use(express.json()); // Parse JSON request bodies

// API Keys from environment variables
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

// Utility function to log with timestamp
const log = (message) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
};

// Utility function to get date range (last 24 hours)
const getDateRange = () => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const formatDate = (date) => {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  };
  
  return {
    from: formatDate(yesterday),
    to: formatDate(today)
  };
};

// Test Claude API connection
const testClaudeAPI = async () => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: 'Hello, respond with "API Working"'
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Unknown error');
    }

    const data = await response.json();
    return { 
      success: true, 
      message: 'Connected successfully',
      response: data.content[0].text 
    };
  } catch (error) {
    return { 
      success: false, 
      message: error.message 
    };
  }
};

// Test Finnhub API connection
const testFinnhubAPI = async () => {
  try {
    const { from, to } = getDateRange();
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=AAPL&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }

    return { 
      success: true, 
      message: 'Connected successfully',
      count: data.length,
      sampleHeadline: data[0]?.headline || 'No headlines available'
    };
  } catch (error) {
    return { 
      success: false, 
      message: error.message 
    };
  }
};

// ==================== ENDPOINTS ====================

// Health check endpoint
app.get('/', (req, res) => {
  log('Health check request received');
  res.json({ 
    status: 'running',
    message: 'AI News Stock Analysis API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /',
      analyze: 'POST /analyze',
      news: 'GET /news/:symbol',
      testClaude: 'GET /test/claude',
      testFinnhub: 'GET /test/finnhub',
      testAll: 'GET /test/all'
    }
  });
});

// POST /analyze - Claude AI stock analysis
app.post('/analyze', async (req, res) => {
  try {
    const { query, news } = req.body;

    // Validate input
    if (!query || !news) {
      log('❌ /analyze - Missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Please provide both "query" and "news" in request body'
      });
    }

    log(`📊 /analyze - Processing query: "${query}"`);

    // Construct the prompt for Claude
    const prompt = `User question: ${query}

Recent news headlines:
${news}

Provide a clear explanation of why this stock is moving today (2-3 sentences).

Then give three distinct perspectives:

1. BULLISH take (1-2 sentences explaining why this could be positive/buying opportunity)
2. BEARISH take (1-2 sentences explaining why this could be negative/warning sign)
3. NEUTRAL take (1-2 sentences explaining why this might be noise/wait-and-see)

Keep each perspective concise and actionable.`;

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      log(`❌ /analyze - Claude API error: ${error.error?.message}`);
      return res.status(response.status).json({
        error: 'Claude API error',
        message: error.error?.message || 'Unknown error occurred'
      });
    }

    const data = await response.json();
    log('✅ /analyze - Analysis completed successfully');

    res.json({
      success: true,
      analysis: data.content[0].text,
      usage: {
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens
      }
    });

  } catch (error) {
    log(`❌ /analyze - Error: ${error.message}`);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET /news/:symbol - Fetch recent news for a stock
app.get('/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();

    log(`📰 /news/${upperSymbol} - Fetching news`);

    // Get date range (last 24 hours)
    const { from, to } = getDateRange();

    // Call Finnhub API
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${upperSymbol}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`
    );

    if (!response.ok) {
      log(`❌ /news/${upperSymbol} - Finnhub API error: HTTP ${response.status}`);
      return res.status(response.status).json({
        error: 'Finnhub API error',
        message: `HTTP ${response.status}: ${response.statusText}`
      });
    }

    const data = await response.json();

    if (data.error) {
      log(`❌ /news/${upperSymbol} - Finnhub error: ${data.error}`);
      return res.status(401).json({
        error: 'Finnhub API error',
        message: data.error
      });
    }

    // Format and limit to 10 most recent articles
    const articles = data
      .slice(0, 10)
      .map(article => ({
        headline: article.headline,
        summary: article.summary,
        datetime: article.datetime,
        source: article.source,
        url: article.url
      }));

    log(`✅ /news/${upperSymbol} - Found ${articles.length} articles`);

    res.json({
      success: true,
      symbol: upperSymbol,
      count: articles.length,
      dateRange: { from, to },
      articles
    });

  } catch (error) {
    log(`❌ /news/${req.params.symbol} - Error: ${error.message}`);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// GET /test/claude - Test Claude API key
app.get('/test/claude', async (req, res) => {
  try {
    log('🧪 /test/claude - Testing Claude API');

    if (!CLAUDE_API_KEY) {
      log('❌ /test/claude - API key not configured');
      return res.status(401).json({
        status: 'error',
        message: 'Claude API key not configured',
        response: null
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: 'Hello, respond with "API Working"'
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      const errorMsg = error.error?.message || 'Unknown error';
      log(`❌ /test/claude - Failed: ${errorMsg}`);
      return res.status(response.status).json({
        status: 'error',
        message: errorMsg,
        response: null
      });
    }

    const data = await response.json();
    log('✅ /test/claude - Success');

    res.json({
      status: 'success',
      message: 'Claude API is working correctly',
      response: data.content[0].text
    });

  } catch (error) {
    log(`❌ /test/claude - Error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: error.message,
      response: null
    });
  }
});

// GET /test/finnhub - Test Finnhub API key
app.get('/test/finnhub', async (req, res) => {
  try {
    log('🧪 /test/finnhub - Testing Finnhub API');

    if (!FINNHUB_API_KEY) {
      log('❌ /test/finnhub - API key not configured');
      return res.status(401).json({
        status: 'error',
        message: 'Finnhub API key not configured',
        count: 0,
        sample_headline: null
      });
    }

    const { from, to } = getDateRange();
    const response = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=AAPL&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`
    );

    if (!response.ok) {
      log(`❌ /test/finnhub - Failed: HTTP ${response.status}`);
      return res.status(response.status).json({
        status: 'error',
        message: `HTTP ${response.status}: ${response.statusText}`,
        count: 0,
        sample_headline: null
      });
    }

    const data = await response.json();

    if (data.error) {
      log(`❌ /test/finnhub - Failed: ${data.error}`);
      return res.status(401).json({
        status: 'error',
        message: data.error,
        count: 0,
        sample_headline: null
      });
    }

    log('✅ /test/finnhub - Success');

    res.json({
      status: 'success',
      message: 'Finnhub API is working correctly',
      count: data.length,
      sample_headline: data[0]?.headline || 'No headlines available'
    });

  } catch (error) {
    log(`❌ /test/finnhub - Error: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: error.message,
      count: 0,
      sample_headline: null
    });
  }
});

// GET /test/all - Test all API keys
app.get('/test/all', async (req, res) => {
  try {
    log('🧪 /test/all - Testing all APIs');

    // Test both APIs in parallel
    const [claudeResult, finnhubResult] = await Promise.all([
      testClaudeAPI(),
      testFinnhubAPI()
    ]);

    const allWorking = claudeResult.success && finnhubResult.success;

    res.json({
      claude: {
        status: claudeResult.success ? 'success' : 'error',
        message: claudeResult.message
      },
      finnhub: {
        status: finnhubResult.success ? 'success' : 'error',
        message: finnhubResult.message
      },
      overall: allWorking ? 'all working' : 'some failed'
    });

    log(`✅ /test/all - Complete (${allWorking ? 'all working' : 'some failed'})`);

  } catch (error) {
    log(`❌ /test/all - Error: ${error.message}`);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ==================== SERVER STARTUP ====================

// Start server and test API keys on startup
app.listen(PORT, async () => {
  log(`🚀 Server running on port ${PORT}`);
  log('');
  log('Testing API connections...');
  log('');

  // Test Claude API
  const claudeTest = await testClaudeAPI();
  if (claudeTest.success) {
    log(`✅ Claude API: Connected`);
  } else {
    log(`❌ Claude API: Error - ${claudeTest.message}`);
  }

  // Test Finnhub API
  const finnhubTest = await testFinnhubAPI();
  if (finnhubTest.success) {
    log(`✅ Finnhub API: Connected (${finnhubTest.count} test articles found)`);
  } else {
    log(`❌ Finnhub API: Error - ${finnhubTest.message}`);
  }

  log('');
  log('API is ready to accept requests');
  log('');
});

