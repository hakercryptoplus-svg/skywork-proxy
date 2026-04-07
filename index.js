const express = require('express');
const state = require('./state');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  next();
});

const SECRET_KEY = process.env.SECRET_KEY || 'Ahmad_Investor_2026';
const TARGET_URL = 'https://desktop-llm.skywork.ai/skycowork_llm/v1/proxy/chat/completions';
const PORT = process.env.PORT || 3000;

app.options('*', (req, res) => res.status(204).end());

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Skywork Proxy is running', tokens: state.getTokens().length });
});

app.post('/v1/chat/completions', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${SECRET_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body;
  const tokens = state.getTokens();

  for (const token of tokens) {
    try {
      const response = await fetch(TARGET_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer dummy',
          'x-skywork-cookies': token
        },
        body: JSON.stringify(body)
      });

      if (response.status === 200) {
        const contentType = response.headers.get('content-type') || 'application/json';
        res.setHeader('Content-Type', contentType);

        const isStream = body?.stream === true || contentType.includes('text/event-stream');
        if (isStream && response.body) {
          res.status(200);
          const reader = response.body.getReader();
          const pump = async () => {
            const { done, value } = await reader.read();
            if (done) return res.end();
            res.write(value);
            return pump();
          };
          await pump();
        } else {
          const data = await response.json();
          res.status(200).json(data);
        }
        return;
      }
    } catch {
      continue;
    }
  }

  res.status(500).json({ error: 'All tokens failed' });
});

app.listen(PORT, () => {
  console.log(`Skywork Proxy running on port ${PORT}`);

  try {
    require('./bot');
  } catch (err) {
    console.error('Bot failed to start:', err.message);
  }
});
