const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// The guides are ES modules (export const GUIDE_XX = {...}); read them as plain objects.
function load(file) {
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/components', file), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src.replace(/^export const (\w+)\s*=/mg, 'exports.$1 =').replace(/^export default /m, 'module.exports.default = '))(mod, mod.exports);
  return Object.values(mod.exports).find(v => v && Array.isArray(v.sections)) || Object.values(mod.exports)[0];
}

for (const file of ['guide-tr.js', 'guide-en.js']) {
  test(`${file}: every section opens (buttons are [name, text] pairs, lists hold strings)`, () => {
    const g = load(file);
    const sections = g.sections || [];
    assert.ok(sections.length > 10, 'sections found');
    for (const s of sections) {
      for (const b of s.buttons || []) {
        const ok = typeof b === 'string' || (Array.isArray(b) && b.length === 2 && b.every(x => typeof x === 'string'));
        assert.ok(ok, `${s.id}: bad button row ${JSON.stringify(b)}`);
      }
      for (const k of ['steps', 'rules', 'tips', 'problems']) for (const x of s[k] || []) assert.ok(x !== undefined && x !== null, `${s.id}.${k}: empty row`);
    }
  });
}
