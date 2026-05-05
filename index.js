const express = require('express');
const state = require('./state');
const collector = require('./collector');
const tg = require('./telegram');

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

function getNextToken() {
  const tokens = state.getTokens();
  if (tokens.length === 0) return null;
  const token = tokens[currentIdx];
  currentIdx = (currentIdx + 1) % tokens.length;
  return token;
}

function getStats() {
  const tokens = state.getTokens();
  return { total: tokens.length, healthy: tokens.length, unhealthy: 0, currentIdx };
}

app.options('*', (req, res) => res.status(204).end());

app.get('/', (req, res) => {
  const stats = getStats();
  const cstats = collector.getStats();
  res.json({
    status: 'ok',
    message: 'Skywork LLM Proxy — auto token rotation + auto collection',
    tokens: stats.total,
    healthy: stats.healthy,
    unhealthy: stats.unhealthy,
    models: MODELS.length,
    collector: {
      running: cstats.running,
      session_success: cstats.success,
      session_failed: cstats.failed,
      pending_push: cstats.pending
    }
  });
});

app.get('/health', (req, res) => {
  const stats = getStats();
  res.json({ status: stats.healthy > 0 ? 'healthy' : 'degraded', ...stats });
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: MODELS.map(id => ({ id, object: 'model', created: 1700000000, owned_by: 'skywork' }))
  });
});

app.get('/v1/stats', (req, res) => {
  const tokens = state.getTokens();
  const details = tokens.map((t, i) => ({
    index: i, suffix: '...' + t.slice(-8), healthy: true
  }));
  res.json({ ...getStats(), tokens: details });
});

app.get('/collector/status', (req, res) => {
  res.json(collector.getStats());
});

function adminAuth(req, res, next) {
  if (req.headers['authorization'] !== `Bearer ${SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.post('/admin/collector/start', adminAuth, (req, res) => {
  res.json({ started: collector.start(), stats: collector.getStats() });
});

app.post('/admin/collector/stop', adminAuth, (req, res) => {
  res.json({ stopped: collector.stop(), stats: collector.getStats() });
});

app.post('/admin/collector/test', adminAuth, async (req, res) => {
  try {
    const result = await collector.testOne();
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body;
  const tokens = state.getTokens();
  const maxRetries = Math.min(tokens.length, 100);
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

        if (isStream) {
          const textBody = await response.text();
          if (textBody.includes('skywork_router_limit') || textBody.includes('rate_limit')) {
            continue;
          }
          console.log(`[proxy] ✅ ${body.model} via ...${token.slice(-8)} (attempt ${attempt + 1})`);
          res.setHeader('Content-Type', contentType);
          return res.status(200).send(textBody);
        }

        const textBody = await response.text();
        if (textBody.includes('skywork_router_limit') || textBody.includes('rate_limit')) {
          console.log(`[proxy] Token ...${token.slice(-8)} rate limited, rotating`);
          continue;
        }

        console.log(`[proxy] ✅ ${body.model} via ...${token.slice(-8)} (attempt ${attempt + 1})`);
        res.setHeader('Content-Type', contentType);
        return res.status(200).send(textBody);
      }

      console.log(`[proxy] Token ...${token.slice(-8)} returned ${response.status}`);

    } catch (e) {
      console.log(`[proxy] Token ...${token.slice(-8)} error: ${e.message}`);
    }
  }

  console.log(`[proxy] ❌ All failed (tried ${triedTokens.size}/${tokens.length})`);
  res.status(503).json({
    error: {
      message: `All tokens exhausted (tried ${triedTokens.size}/${tokens.length})`,
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

  // Auto-start collector if enabled
  if (process.env.START_COLLECTOR === '1') {
    tg.attach(collector);
    if (tg.ENABLED) {
      tg.pollUpdates().catch(e => console.error('[tg] poll loop crashed:', e.message));
      tg.send(`🚀 <b>skywork-proxy started</b>\n📦 Tokens: ${stats.total}\n🤖 Collector: ON\n💬 /status /stop /start`).catch(() => {});
    }
    collector.start();
  } else {
    console.log('[skywork-proxy] 💤 Collector OFF (set START_COLLECTOR=1 to enable)');
  }
});
