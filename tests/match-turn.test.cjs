const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TaskEngine } = require('../src/main/services/task-engine.cjs');

// "Stop all" (user 2026-11-12): accounts waiting in the one-at-a-time Quick Play line leave it at once
test('match line: a stopped account leaves the line at once; a later turn after its stop is skipped', async () => {
  const engine = new TaskEngine({ store: { getAccounts: () => [] }, credentials: {}, registry: {}, browserService: {}, activity: { add() {} } });
  let release;
  const first = engine._matchTurn(() => new Promise(r => { release = r; }));
  const a = new AbortController();
  let ran = false;
  const second = engine._matchTurn(async () => { ran = true; }, a.signal);
  const t0 = Date.now();
  a.abort();
  await assert.rejects(second, e => e.name === 'AbortError');
  assert.ok(Date.now() - t0 < 100, 'left the line without waiting for the first turn');
  release('done');
  assert.equal(await first, 'done');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(ran, false, 'its turn was skipped');
  const third = await engine._matchTurn(async () => 'next');
  assert.equal(third, 'next', 'the line goes on');
});

test("user's stop wins: a start from a loop that began before the stop is skipped; the user's own start runs", async () => {
  const engine = new TaskEngine({ store: { getAccounts: () => [] }, credentials: {}, registry: {}, browserService: {}, activity: { add() {} } });
  const prepared = [];
  engine.prepareAccount = async id => { prepared.push(id); };
  engine.activatePrepared = async () => ({ ok: true });
  const loopBegan = Date.now() - 1000;
  engine.markUserStop(['a']);
  assert.deepEqual(await engine.startAccount('a', 't', { since: loopBegan }), { skipped: true });
  await engine.startAccount('b', 't', { since: loopBegan });
  await engine.startAccount('a', 't');
  assert.deepEqual(prepared, ['b', 'a']);
  assert.equal(engine.stoppedByUserSince('a', Date.now() + 1000), false, 'a resume that began after the stop may start it');
});
