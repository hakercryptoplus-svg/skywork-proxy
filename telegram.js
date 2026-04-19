const TG_TOKEN = process.env.TG_TOKEN || '';
const TG_CHAT = process.env.TG_CHAT || '';
const ENABLED = !!(TG_TOKEN && TG_CHAT);

let collectorRef = null;
let lastUpdateId = 0;
let polling = false;

async function send(text) {
  if (!ENABLED) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error('[tg] send error:', e.message);
  }
}

async function pollUpdates() {
  if (!ENABLED || polling) return;
  polling = true;
  while (polling) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates?timeout=30&offset=${lastUpdateId + 1}`);
      const j = await r.json();
      if (j.ok && Array.isArray(j.result)) {
        for (const u of j.result) {
          lastUpdateId = u.update_id;
          const msg = u.message;
          if (!msg || String(msg.chat?.id) !== String(TG_CHAT)) continue;
          await handleCommand((msg.text || '').trim());
        }
      }
    } catch (e) {
      console.error('[tg] poll error:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function handleCommand(text) {
  if (!collectorRef) return;
  const cmd = text.toLowerCase().split('@')[0];
  if (cmd === '/stop' || cmd === '/pause') {
    if (collectorRef.stop()) await send('🛑 Collector stopped');
    else await send('ℹ️ Already stopped');
  } else if (cmd === '/start' || cmd === '/resume') {
    if (collectorRef.start()) await send('▶️ Collector started');
    else await send('ℹ️ Already running');
  } else if (cmd === '/status' || cmd === '/stats') {
    const s = collectorRef.getStats();
    const upMin = s.startedAt ? Math.round((Date.now() - s.startedAt) / 60000) : 0;
    await send(
      `📊 <b>Status</b>\n` +
      `Running: ${s.running ? '✅' : '🛑'}\n` +
      `Total tokens: <b>${s.total}</b>\n` +
      `Session: +${s.success} (failed ${s.failed} of ${s.attempted})\n` +
      `Pending push: ${s.pending}/${s.saveEvery}\n` +
      `Concurrency: ${s.concurrency}\n` +
      `Uptime: ${upMin}m`
    );
  } else if (cmd === '/help') {
    await send('Commands:\n/start - resume\n/stop - pause\n/status - stats\n/help - this');
  }
}

function attach(collector) { collectorRef = collector; }

module.exports = { send, attach, pollUpdates, ENABLED };
