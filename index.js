const express = require('express');
const state = require('./state');
const collector = require('./collector');
const tg = require('./telegram');
const generateLiteLLMConfig = require('./generate_litellm_config');

// توليد الإعدادات عند بدء التشغيل
generateLiteLLMConfig();

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  next();
});

const SECRET_KEY = process.env.SECRET_KEY || 'Ahmad_Investor_2026';
const TARGET_URL = 'https://desktop-llm.skywork.ai/skycowork_llm/v1/chat/completions';
const PORT = process.env.COLLECTOR_PORT || 3001;

const MODELS = [
  'claude-opus-4.6','claude-opus-4.7','claude-sonnet-4.6','claude-haiku-4.5',
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
  
  if (token && !token.startsWith('token=')) {
    return `token=${token}`;
  }
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
    message: 'Skywork LLM Proxy — auto token rotation + auto collection (Enhanced Version)',
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

app.get('/admin/models', (req, res) => {
  res.json({
    object: 'list',
    data: MODELS.map(id => ({ id, object: 'model', created: 1700000000, owned_by: 'skywork' }))
  });
});

app.get('/admin/stats', (req, res) => {
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

// تم نقل /v1/chat/completions إلى LiteLLM
// سنبقي هذا المسار فقط للاختبار أو كنسخة احتياطية بمسار مختلف
app.post('/admin/chat/test', async (req, res) => {
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

      console.log(`[proxy] Trying token ...${token.slice(-8)}`);
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

      const textBody = await response.text();
      
      // التحقق من Rate Limit أو أخطاء الراوتر
      if (textBody.includes('skywork_router_limit') || textBody.includes('rate_limit') || textBody.includes('LLM API 调用失败')) {
        console.log(`[proxy] Token ...${token.slice(-8)} limited or failed, rotating. Response: ${textBody.substring(0, 100)}`);
        continue;
      }

      if (response.status === 200) {
        let jsonResponse;
        try {
          jsonResponse = JSON.parse(textBody);
        } catch (e) {
          res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
          return res.status(200).send(textBody);
        }

        if (jsonResponse && jsonResponse.data && jsonResponse.code === 0) {
          console.log(`[proxy] ✅ ${body.model} via ...${token.slice(-8)} (unwrapped)`);
          res.setHeader('Content-Type', 'application/json');
          return res.status(200).json(jsonResponse.data);
        }

        console.log(`[proxy] ✅ ${body.model} via ...${token.slice(-8)} (original)`);
        res.setHeader('Content-Type', 'application/json');
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
      message: `All tokens exhausted or service failed (tried ${triedTokens.size}/${tokens.length})`,
      type: 'service_unavailable'
    }
  });
});

// تعطيل خادم Express لمنع التعارض مع LiteLLM
// سنقوم بتشغيل الجامع مباشرة
const stats = getStats();
console.log(`[skywork-proxy] 🔑 ${stats.total} tokens loaded`);
console.log(`[skywork-proxy] 🔄 Auto rotation enabled`);

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
