const express = require('express');
const state = require('./state');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  next();
});

const SECRET_KEY = process.env.SECRET_KEY || 'Ahmad_Investor_2026';
const TARGET_URL = 'https://desktop-llm.skywork.ai/skycowork_llm/v1/proxy/chat/completions';
const PORT = process.env.PORT || 3000;

const MODELS = [
  'claude-opus-4.6','claude-sonnet-4.6','claude-haiku-4.5',
  'gemini-3.1-pro','gemini-3-flash-preview',
  'kimi-k2.5','kimi-k2','minimax-m2.5',
  'deepseek-v3','deepseek-r1',
  'gpt-4o','o3','grok-4.1','glm-5','qwen3-coder'
];

let currentIdx = 0;
const tokenHealth = new Map();

function getTokenStatus(token) {
  if (!tokenHealth.has(token)) {
    tokenHealth.set(token, { fails: 0, lastFail: 0, cooldownMs: 60000 });
  }
  return tokenHealth.get(token);
}

function isTokenHealthy(token) {
  const h = getTokenStatus(token);
  if (h.fails < 3) return true;
  if (Date.now() - h.lastFail > h.cooldownMs) {
    h.fails = 0;
    return true;
  }
  return false;
}

function recordTokenFail(token) {
  const h = getTokenStatus(token);
  h.fails++;
  h.lastFail = Date.now();
  h.cooldownMs = Math.min(h.cooldownMs * 2, 600000);
}

function recordTokenSuccess(token) {
  const h = getTokenStatus(token);
  h.fails = 0;
  h.cooldownMs = 60000;
}

function getNextToken() {
  const tokens = state.getTokens();
  if (tokens.length === 0) return null;
  const startIdx = currentIdx;
  for (let i = 0; i < tokens.length; i++) {
    const idx = (startIdx + i) % tokens.length;
    if (isTokenHealthy(tokens[idx])) {
      currentIdx = (idx + 1) % tokens.length;
      return tokens[idx];
    }
  }
  tokenHealth.clear();
  currentIdx = (currentIdx + 1) % tokens.length;
  return tokens[currentIdx];
}

function getStats() {
  const tokens = state.getTokens();
  let healthy = 0;
  tokens.forEach(t => { if (isTokenHealthy(t)) healthy++; });
  return { total: tokens.length, healthy, unhealthy: tokens.length - healthy, currentIdx };
}

app.options('*', (req, res) => res.status(204).end());

app.get('/', (req, res) => {
  const stats = getStats();
  res.json({
    status: 'ok',
    message: 'Skywork LLM Proxy — auto token rotation',
    tokens: stats.total,
    healthy: stats.healthy,
    unhealthy: stats.unhealthy,
    models: MODELS.length
  });
});

app.get('/health', (req, res) => {
  const stats = getStats();
  res.json({ status: stats.healthy > 0 ? 'healthy' : 'degraded', ...stats });
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: MODELS.map(id => ({
      id, object: 'model', created: 1700000000, owned_by: 'skywork'
    }))
  });
});

app.get('/v1/stats', (req, res) => {
  const tokens = state.getTokens();
  const details = tokens.map((t, i) => {
    const h = getTokenStatus(t);
    return {
      index: i, suffix: '...' + t.slice(-8),
      healthy: isTokenHealthy(t), fails: h.fails,
      lastFail: h.lastFail ? new Date(h.lastFail).toISOString() : null
    };
  });
  res.json({ ...getStats(), tokens: details });
});

app.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body;
  const tokens = state.getTokens();
  const maxRetries = Math.min(tokens.length, 15);
  const triedTokens = new Set();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const token = getNextToken();
    if (!token || triedTokens.has(token)) continue;
    triedTokens.add(token);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);

      const response = await fetch(TARGET_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer dummy',
          'x-skywork-cookies': token,
          'Origin': 'https://skywork.ai',
          'Referer': 'https://skywork.ai/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (response.status === 200) {
        const contentType = response.headers.get('content-type') || 'application/json';
        const isStream = body?.stream === true || contentType.includes('text/event-stream');

        if (isStream && response.body) {
          const textBody = await response.text();
          if (textBody.includes('skywork_router_limit') || textBody.includes('rate_limit')) {
            recordTokenFail(token);
            continue;
          }
          recordTokenSuccess(token);
          console.log(`[proxy] ✅ ${body.model} via ...${token.slice(-8)} (attempt ${attempt + 1})`);
          res.setHeader('Content-Type', contentType);
          return res.status(200).send(textBody);
        }

        const textBody = await response.text();
        if (textBody.includes('skywork_router_limit') || textBody.includes('rate_limit')) {
          console.log(`[proxy] Token ...${token.slice(-8)} rate limited, rotating`);
          recordTokenFail(token);
          continue;
        }

        recordTokenSuccess(token);
        console.log(`[proxy] ✅ ${body.model} via ...${token.slice(-8)} (attempt ${attempt + 1})`);
        res.setHeader('Content-Type', contentType);
        return res.status(200).send(textBody);
      }

      console.log(`[proxy] Token ...${token.slice(-8)} returned ${response.status}`);
      recordTokenFail(token);

    } catch (e) {
      console.log(`[proxy] Token ...${token.slice(-8)} error: ${e.message}`);
      recordTokenFail(token);
    }
  }

  const stats = getStats();
  console.log(`[proxy] ❌ All failed (tried ${triedTokens.size}, healthy: ${stats.healthy}/${stats.total})`);
  res.status(503).json({
    error: {
      message: `All tokens exhausted (tried ${triedTokens.size}/${tokens.length}, healthy: ${stats.healthy})`,
      type: 'service_unavailable'
    }
  });
});

app.listen(PORT, () => {
  const stats = getStats();
  console.log(`[skywork-proxy] ✅ Running on port ${PORT}`);
  console.log(`[skywork-proxy] 🔑 ${stats.total} tokens loaded (${stats.healthy} healthy)`);
  console.log(`[skywork-proxy] 📦 ${MODELS.length} models available`);
  console.log(`[skywork-proxy] 🔄 Auto rotation enabled`);

  try {
    require('./bot');
  } catch (err) {
    console.error('Bot failed to start:', err.message);
  }
});
