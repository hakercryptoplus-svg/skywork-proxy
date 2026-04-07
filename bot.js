const TelegramBot = require('node-telegram-bot-api');
const state = require('./state');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8329901696:AAHAb3Z0TXZKxHsFn6mQ3zeBbXS4Gd7JYzY';
const ALLOWED_CHAT_ID = parseInt(process.env.TELEGRAM_CHAT_ID || '7281928709');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'hakercryptoplus-svg/skywork-proxy';
const SKYWORK_URL = 'https://desktop-llm.skywork.ai/skycowork_llm/v1/proxy/chat/completions';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function isAllowed(msg) {
  return msg.chat.id === ALLOWED_CHAT_ID;
}

function maskToken(token) {
  if (token.length <= 30) return token;
  return token.substring(0, 18) + '...' + token.slice(-10);
}

async function pushToGitHub(tokens) {
  if (!GITHUB_TOKEN) return false;
  try {
    const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/tokens.json`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': 'skywork-bot' }
    });
    const fileData = await getRes.json();
    const content = Buffer.from(JSON.stringify(tokens, null, 2)).toString('base64');
    const putRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/tokens.json`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'skywork-bot'
      },
      body: JSON.stringify({
        message: 'تحديث المفاتيح عبر بوت تيليجرام',
        content,
        sha: fileData.sha
      })
    });
    return putRes.status === 200 || putRes.status === 201;
  } catch (e) {
    console.error('GitHub push error:', e.message);
    return false;
  }
}

async function testToken(token) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(SKYWORK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer dummy',
        'x-skywork-cookies': token
      },
      body: JSON.stringify({
        model: 'Skywork-o3-mini',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false
      }),
      signal: controller.signal
    });
    clearTimeout(t);
    return res.status === 200;
  } catch {
    return false;
  }
}

bot.onText(/\/start/, (msg) => {
  if (!isAllowed(msg)) return;
  bot.sendMessage(msg.chat.id,
    `🤖 Skywork Proxy Bot\n\nأهلاً! أنا البوت المسؤول عن إدارة الـ Proxy.\n\n` +
    `📋 الأوامر المتاحة:\n\n` +
    `🔑 /tokens — عرض جميع المفاتيح\n` +
    `➕ /add token — إضافة مفتاح جديد\n` +
    `🗑 /remove رقم — حذف مفتاح\n` +
    `🧪 /test — اختبار جميع المفاتيح\n` +
    `📊 /status — حالة الخدمة\n` +
    `❓ /help — المساعدة`
  );
});

bot.onText(/\/help/, (msg) => {
  if (!isAllowed(msg)) return;
  bot.sendMessage(msg.chat.id,
    `📖 دليل الاستخدام:\n\n` +
    `إضافة مفتاح:\n` +
    `/add token=xxxx...yyyy\n` +
    `أو بدون كلمة token=:\n` +
    `/add xxxx...yyyy\n\n` +
    `حذف مفتاح:\n` +
    `/remove 3 — يحذف المفتاح رقم 3\n\n` +
    `الاختبار:\n` +
    `/test — يختبر كل مفتاح ويعرض ✅ أو ❌`
  );
});

bot.onText(/\/tokens/, (msg) => {
  if (!isAllowed(msg)) return;
  const tokens = state.getTokens();
  if (tokens.length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ لا يوجد مفاتيح حالياً.\n\nأضف مفتاح بالأمر:\n/add token');
  }
  const list = tokens.map((t, i) => `${i + 1}. ${maskToken(t)}`).join('\n');
  bot.sendMessage(msg.chat.id, `🔑 المفاتيح الحالية (${tokens.length}):\n\n${list}`);
});

bot.onText(/\/add (.+)/, async (msg, match) => {
  if (!isAllowed(msg)) return;
  let token = match[1].trim();
  if (!token.startsWith('token=')) token = 'token=' + token;

  const existing = state.getTokens();
  if (existing.includes(token)) {
    return bot.sendMessage(msg.chat.id, '⚠️ هذا المفتاح موجود مسبقاً!');
  }

  state.addToken(token);
  const savingMsg = await bot.sendMessage(msg.chat.id, '⏳ جاري حفظ المفتاح على GitHub...');
  const saved = await pushToGitHub(state.getTokens());

  bot.editMessageText(
    saved
      ? `✅ تم إضافة المفتاح بنجاح!\n\n💾 تم الحفظ على GitHub\n🔑 المجموع: ${state.getTokens().length} مفاتيح`
      : `✅ تم إضافة المفتاح في الذاكرة\n\n⚠️ لم يتم الحفظ على GitHub (تأكد من GITHUB_TOKEN)\n🔑 المجموع: ${state.getTokens().length} مفاتيح`,
    { chat_id: msg.chat.id, message_id: savingMsg.message_id }
  );
});

bot.onText(/\/remove (\d+)/, async (msg, match) => {
  if (!isAllowed(msg)) return;
  const index = parseInt(match[1]) - 1;
  const tokens = state.getTokens();

  if (index < 0 || index >= tokens.length) {
    return bot.sendMessage(msg.chat.id, `❌ رقم غير صحيح. المفاتيح من 1 إلى ${tokens.length}`);
  }

  const removed = tokens[index];
  state.removeToken(index);
  const saved = await pushToGitHub(state.getTokens());

  bot.sendMessage(msg.chat.id,
    `🗑 تم حذف المفتاح رقم ${index + 1}\n${maskToken(removed)}\n\n` +
    `${saved ? '💾 تم الحفظ على GitHub' : '⚠️ لم يتم الحفظ على GitHub'}\n` +
    `🔑 المتبقي: ${state.getTokens().length} مفاتيح`
  );
});

bot.onText(/\/test/, async (msg) => {
  if (!isAllowed(msg)) return;
  const tokens = state.getTokens();

  if (tokens.length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ لا يوجد مفاتيح للاختبار');
  }

  const waitMsg = await bot.sendMessage(msg.chat.id, `⏳ جاري اختبار ${tokens.length} مفاتيح... (قد يأخذ بعض الوقت)`);
  const results = await Promise.all(tokens.map(t => testToken(t)));
  const working = results.filter(Boolean).length;

  const list = tokens.map((t, i) =>
    `${i + 1}. ${results[i] ? '✅' : '❌'} ${maskToken(t)}`
  ).join('\n');

  bot.editMessageText(
    `🧪 نتائج الاختبار:\n\n${list}\n\n` +
    `✅ تعمل: ${working}  |  ❌ لا تعمل: ${tokens.length - working}`,
    { chat_id: msg.chat.id, message_id: waitMsg.message_id }
  );
});

bot.onText(/\/status/, async (msg) => {
  if (!isAllowed(msg)) return;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch('https://skywork-proxy.onrender.com/', { signal: controller.signal });
    clearTimeout(t);
    const data = await res.json();
    bot.sendMessage(msg.chat.id,
      `📊 حالة الخدمة:\n\n` +
      `${data.status === 'ok' ? '✅ تعمل بشكل طبيعي' : '⚠️ مشكلة في الخدمة'}\n` +
      `🔗 https://skywork-proxy.onrender.com\n` +
      `🔑 عدد المفاتيح: ${state.getTokens().length}`
    );
  } catch {
    bot.sendMessage(msg.chat.id, '❌ الخدمة لا تستجيب\nقد تكون في وضع السكون (Render Free)');
  }
});

bot.on('polling_error', (err) => {
  console.error('Telegram polling error:', err.message);
});

console.log('Telegram bot started ✅');

module.exports = bot;
