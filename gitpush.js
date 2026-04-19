const state = require('./state');

const REPO = process.env.GITHUB_REPO || 'hakercryptoplus-svg/skywork-proxy';
const FILE_PATH = 'tokens.json';
const BRANCH = process.env.GITHUB_BRANCH || 'main';

let pushing = false;
let queued = false;

async function pushNow(message) {
  const TOKEN = process.env.GITHUB_TOKEN;
  if (!TOKEN) throw new Error('GITHUB_TOKEN not set');

  const cur = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`,
    { headers: { Authorization: 'Bearer ' + TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'skywork-collector' } }
  );
  if (!cur.ok) throw new Error('GET failed: ' + cur.status + ' ' + (await cur.text()).slice(0, 200));
  const sha = (await cur.json()).sha;

  const content = state.serialize();
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'skywork-collector',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: message + ' [skip render][skip ci]',
      content: Buffer.from(content).toString('base64'),
      sha,
      branch: BRANCH,
      committer: { name: 'token-collector', email: 'collector@skywork-proxy.bot' }
    })
  });
  if (!r.ok) throw new Error('PUT failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

async function commitAndPush(message) {
  if (pushing) { queued = true; return; }
  pushing = true;
  try {
    await pushNow(message);
  } finally {
    pushing = false;
    if (queued) {
      queued = false;
      setImmediate(() => commitAndPush('Sync tokens (followup)').catch(e => console.error('[gitpush]', e.message)));
    }
  }
}

module.exports = { commitAndPush };
