const crypto = require('crypto');
const state = require('./state');
const tg = require('./telegram');
const { commitAndPush } = require('./gitpush');
const generateLiteLLMConfig = require('./generate_litellm_config');

const SAVE_EVERY = parseInt(process.env.SAVE_EVERY || '20');
const CONCURRENCY = parseInt(process.env.COLLECTOR_CONCURRENCY || '3');
const POLL_INTERVAL = 3000;
const MAX_WAIT_CODE_MS = 120000;
const MAX_WAIT_TOKEN_MS = 80000;
const INTER_ATTEMPT_DELAY_MS = 1500;

let running = false;
let workers = 0;
let stats = { attempted: 0, success: 0, failed: 0, lastReason: '', lastCollected: 0, startedAt: null };
let pendingCommit = 0;

function did() { return crypto.randomBytes(16).toString('hex'); }

function skyHeaders(d) {
  return {
    'Content-Type': 'application/json',
    'Origin': 'https://skywork.ai',
    'Referer': 'https://skywork.ai/',
    'device_id': d,
    'device_hash': d,
    'device': 'web',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
}

async function safeJson(r) { try { return JSON.parse(await r.text()); } catch { return null; } }

async function createInbox() {
  const r = await fetch('https://www.minuteinbox.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const sid = (r.headers.get('set-cookie') || '').match(/PHPSESSID=([^;]+)/)?.[1];
  if (!sid) throw new Error('no PHPSESSID');
  const cookie = 'PHPSESSID=' + sid;
  const H = {
    'Cookie': cookie,
    'User-Agent': 'Mozilla/5.0',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': 'https://www.minuteinbox.com/',
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  const user = 'sky' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 5);
  await fetch('https://www.minuteinbox.com/index/email-check/', { method: 'POST', headers: H, body: 'email=' + user + '&format=json' });
  await fetch('https://www.minuteinbox.com/index/new-email/', { method: 'POST', headers: H, body: 'emailInput=' + user + '&format=json' });
  const idx = await safeJson(await fetch('https://www.minuteinbox.com/index/index', { headers: H }));
  if (!idx?.email) throw new Error('no email assigned');
  return { email: idx.email, cookie };
}

async function pollCode(cookie, deadline) {
  const H = { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.minuteinbox.com/' };
  while (Date.now() < deadline && running) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    try {
      const r = await fetch('https://www.minuteinbox.com/index/refresh', { headers: H });
      const txt = (await r.text()).replace(/^\ufeff/, '').trim();
      const msgs = JSON.parse(txt);
      for (const m of msgs) {
        const sender = (m.od || '').toLowerCase();
        const subj = (m.predmet || '').toLowerCase();
        if (sender.includes('skywork') || sender.includes('notice') || subj.includes('skywork') || subj.includes('verif') || subj.includes('code')) {
          const r2 = await fetch('https://www.minuteinbox.com/email/id/' + m.id, { headers: H });
          const body = await r2.text();
          const code = (body.match(/\b(\d{6})\b/) || [])[1];
          if (code) return code;
        }
      }
    } catch {}
  }
  return null;
}

async function collectOne() {
  const inbox = await createInbox();
  const d = did();
  const sH = skyHeaders(d);

  const sr = await fetch('https://api.skywork.ai/usercenter/email/send', {
    method: 'POST', headers: sH, body: JSON.stringify({ send_address: inbox.email, extend: {} })
  });
  const sj = await safeJson(sr);
  if (sj?.code !== 0) return { ok: false, reason: 'send: ' + (sj?.message || sr.status) };

  const code = await pollCode(inbox.cookie, Date.now() + MAX_WAIT_CODE_MS);
  if (!code) return { ok: false, reason: 'no_code (IP may be blocked)' };

  const lr = await fetch('https://api.skywork.ai/usercenter/email/login', {
    method: 'POST', headers: sH,
    body: JSON.stringify({ login_email_address: inbox.email, login_code: code, inviter_user_key: '' })
  });
  const ld = await safeJson(lr);
  const skytk = ld?.data?.token || ld?.data?.access_token;
  if (!skytk) return { ok: false, reason: 'login: ' + (ld?.message || 'no token') };

  const ah = { Authorization: 'Bearer ' + skytk, Cookie: 'token=' + skytk + '; isLogin=Y', 'Content-Type': 'application/json' };

  const cr = await fetch('https://api.skywork.ai/chat/skybot', { method: 'POST', headers: ah, body: '{}' });
  const cd = await safeJson(cr);
  let userToken = cd?.data?.user_token;
  if (userToken && (userToken.endsWith('.cv3') || userToken.endsWith('.cv4'))) {
    return { ok: true, token: userToken };
  }

  const deadline = Date.now() + MAX_WAIT_TOKEN_MS;
  while (Date.now() < deadline && running) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const r = await fetch('https://api.skywork.ai/chat/skybot', { headers: ah });
      if (r.status === 200) {
        const d = (await r.json()).data || {};
        if (d.user_token && (d.user_token.endsWith('.cv3') || d.user_token.endsWith('.cv4'))) {
          return { ok: true, token: d.user_token };
        }
        if (d.status === 'error' || d.status === 'failed') return { ok: false, reason: 'claim_failed' };
      }
    } catch {}
  }
  return { ok: false, reason: 'timeout_user_token' };
}

async function maybePush() {
  if (pendingCommit < SAVE_EVERY) return;
  const n = pendingCommit;
  pendingCommit = 0;
  try {
    state.persist();
    generateLiteLLMConfig();
  } catch (e) {
    console.error('[collector] persist failed:', e.message);
  }
  const total = state.getTokens().length;
  tg.send(`🆕 +${n} new tokens\n📦 Total: <b>${total}</b>\n⏳ Pushing to GitHub...`).catch(() => {});
  try {
    await commitAndPush(`Add ${n} new tokens (total: ${total})`);
    tg.send(`✅ Pushed (total: <b>${total}</b>)`).catch(() => {});
  } catch (e) {
    console.error('[collector] git push failed:', e.message);
    tg.send(`⚠️ Push failed: ${e.message}`).catch(() => {});
  }
}

async function worker(id) {
  workers++;
  while (running) {
    stats.attempted++;
    try {
      const r = await collectOne();
      if (r.ok) {
        if (state.hasToken(r.token)) {
          stats.failed++;
          stats.lastReason = 'duplicate';
        } else {
          state.addToken(r.token);
          stats.success++;
          stats.lastCollected = Date.now();
          pendingCommit++;
          const total = state.getTokens().length;
          console.log(`[collector#${id}] ✅ #${total} (...${r.token.slice(-10)}) | session +${stats.success}/${stats.attempted}`);
          maybePush().catch(() => {});
        }
      } else {
        stats.failed++;
        stats.lastReason = r.reason;
        if (stats.failed % 5 === 0) console.log(`[collector#${id}] last fail: ${r.reason} (${stats.failed} fails)`);
      }
    } catch (e) {
      stats.failed++;
      stats.lastReason = 'exception:' + e.message;
      console.error(`[collector#${id}] error:`, e.message);
    }
    if (running) await new Promise(r => setTimeout(r, INTER_ATTEMPT_DELAY_MS));
  }
  workers--;
}

function start() {
  if (running) return false;
  running = true;
  stats = { attempted: 0, success: 0, failed: 0, lastReason: '', lastCollected: 0, startedAt: Date.now() };
  for (let i = 0; i < CONCURRENCY; i++) worker(i + 1);
  console.log(`[collector] STARTED concurrency=${CONCURRENCY} saveEvery=${SAVE_EVERY}`);
  return true;
}

function stop() {
  if (!running) return false;
  running = false;
  console.log('[collector] STOPPING...');
  return true;
}

function getStats() {
  return { ...stats, running, workers, total: state.getTokens().length, pending: pendingCommit, saveEvery: SAVE_EVERY, concurrency: CONCURRENCY };
}

async function testOne() {
  const t0 = Date.now();
  const wasRunning = running;
  if (!wasRunning) running = true; // allow inner loops
  try {
    const r = await collectOne();
    return { ...r, elapsed_ms: Date.now() - t0 };
  } finally {
    if (!wasRunning) running = false;
  }
}

module.exports = { start, stop, getStats, testOne };
