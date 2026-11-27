const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eachStaggered } = require('../src/main/services/wide.cjs');

// Long match runs (user 2026-11-27): only the start is limited; the next group starts as soon as
// the first one has its match, so every account plays at the same time in the end.
test('eachStaggered: at most `limit` accounts starting at once, all of them playing together', async () => {
  let starting = 0, most = 0, playing = 0, mostPlaying = 0;
  await eachStaggered(Array.from({ length: 10 }, (_, i) => i), async (x, i, started) => {
    starting++; most = Math.max(most, starting);
    await new Promise(r => setTimeout(r, 20));
    starting--; started();
    playing++; mostPlaying = Math.max(mostPlaying, playing);
    await new Promise(r => setTimeout(r, 200));
    playing--;
  }, 3);
  assert.equal(most, 3);
  assert.equal(mostPlaying, 10);
});

test('eachStaggered: an account that ends or fails without starting frees its place', async () => {
  const done = [];
  await eachStaggered([1, 2, 3, 4], async x => { if (x === 1) throw new Error('x'); done.push(x); }, 1);
  assert.deepEqual(done.sort(), [2, 3, 4]);
});
