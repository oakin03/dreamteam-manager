// Filipino UI text: src/renderer/i18n/fil.json maps the English text to Filipino.
// filOf(en) returns a Filipino copy of a language table (same shape, every string looked
// up there); a text without an entry stays English. `npm run i18n:missing` lists them.
import FIL from './i18n/fil.json';

export { FIL };
const cache = new WeakMap();
export function filOf(en) {
  if (!en || typeof en !== 'object') return en;
  if (cache.has(en)) return cache.get(en);
  const walk = v => typeof v === 'string' ? (FIL[v] ?? v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  const fil = walk(en);
  cache.set(en, fil);
  return fil;
}
