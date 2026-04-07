const fs = require('fs');
const path = require('path');

let tokens = [];

try {
  tokens = JSON.parse(fs.readFileSync(path.join(__dirname, 'tokens.json'), 'utf8'));
} catch {
  tokens = [];
}

module.exports = {
  getTokens: () => tokens,
  addToken: (t) => { tokens.push(t); },
  removeToken: (i) => { tokens.splice(i, 1); },
  setTokens: (t) => { tokens = [...t]; }
};
