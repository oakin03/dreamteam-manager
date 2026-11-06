const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextProp, SMALL, MEDIUM } = require('../src/main/services/prop-service.cjs');

test('Props: +30 at 75 or below, +10 above it, until 95 (user 2026-11-06)', () => {
  const both = { [SMALL]: 9, [MEDIUM]: 9 };
  assert.equal(nextProp(95, both), null);
  assert.equal(nextProp(94, both), SMALL, '94 still gets a +10 (waste is fine)');
  assert.equal(nextProp(76, both), SMALL, 'less than 25 missing: +10');
  assert.equal(nextProp(75, both), MEDIUM, '25 missing: +30');
  assert.equal(nextProp(15, both), MEDIUM);
  // the user's examples, played out
  const play = start => { let s = start; const out = []; const left = { ...both }; for (let p; (p = nextProp(s, left));) { left[p]--; out.push(p === MEDIUM ? 30 : 10); s = Math.min(100, s + (p === MEDIUM ? 30 : 10)); } return out.join('-'); };
  assert.equal(play(15), '30-30-30');
  assert.equal(play(55), '30-10');
  assert.equal(play(80), '10-10');
  // the one it needs is gone: the other one, but no +30 above 85
  assert.equal(nextProp(50, { [SMALL]: 5, [MEDIUM]: 0 }), SMALL);
  assert.equal(nextProp(85, { [SMALL]: 0, [MEDIUM]: 5 }), MEDIUM);
  assert.equal(nextProp(86, { [SMALL]: 0, [MEDIUM]: 5 }), null, 'no +30 above 85');
  assert.equal(nextProp(50, { [SMALL]: 0, [MEDIUM]: 0 }), null);
});
