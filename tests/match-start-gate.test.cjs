const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchStartSlot } = require('../src/main/services/match-start-gate.cjs');

test('match starts from several accounts at once are kept apart (the game names a match "<mode>-<ms>")', async () => {
  const at = [];
  await Promise.all([1, 2, 3].map(() => matchStartSlot(null, 60).then(() => at.push(Date.now()))));
  assert.equal(at.length, 3);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 55, `start ${i} came ${at[i] - at[i - 1]} ms after the previous one`);
});

test('a stopped run leaves the gate usable', async () => {
  const c = new AbortController();
  const waiting = matchStartSlot(c.signal, 5000);
  c.abort();
  await assert.rejects(waiting, /Aborted/);
  await matchStartSlot(null, 0);
});
