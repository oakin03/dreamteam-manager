// Lists the English UI texts that have no entry in src/renderer/i18n/fil.json yet.
// It reads every `en: { ... }` language table of the renderer sources. Add the missing
// texts to fil.json ("English": "Filipino"; a text that stays the same maps to itself).
// usage: npm run i18n:missing
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'src', 'renderer');
const fil = JSON.parse(fs.readFileSync(path.join(root, 'i18n', 'fil.json'), 'utf8'));
const files = ['App.jsx', ...fs.readdirSync(path.join(root, 'components')).filter(f => /\.(jsx|js)$/.test(f)).map(f => 'components/' + f)];

function blockEnd(src, start) {
  let depth = 0, q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const missing = new Map(); // text -> first place
const walk = (v, where) => {
  if (typeof v === 'string') { if (!(v in fil) && !missing.has(v)) missing.set(v, where); return; }
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${where}.${i}`));
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
};
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const re = /(^|[\s,{])en\s*:\s*\{/gm;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index + m[0].length - 1);
    const close = blockEnd(src, open);
    if (close < 0) continue;
    try { walk(new Function(`return (${src.slice(open, close + 1)})`)(), f); } catch {}
    re.lastIndex = close;
  }
}
if (!missing.size) console.log('Every English text has a Filipino entry.');
else for (const [text, where] of missing) console.log(`${where}\t${JSON.stringify(text)}`);
