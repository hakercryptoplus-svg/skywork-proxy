const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'tokens.json');

let tokens = [];
let tokenSet = new Set();

try {
  tokens = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  tokenSet = new Set(tokens);
} catch {
  tokens = [];
  tokenSet = new Set();
}

module.exports = {
  getTokens: () => tokens,
  hasToken: (t) => tokenSet.has(t),
  addToken: (t) => {
    if (tokenSet.has(t)) return false;
    tokens.push(t);
    tokenSet.add(t);
    return true;
  },
  removeToken: (i) => {
    const t = tokens[i];
    if (t) tokenSet.delete(t);
    tokens.splice(i, 1);
  },
  setTokens: (t) => {
    tokens = [...t];
    tokenSet = new Set(tokens);
  },
  persist: () => {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(tokens));
    fs.renameSync(tmp, FILE);
  },
  serialize: () => JSON.stringify(tokens)
};
