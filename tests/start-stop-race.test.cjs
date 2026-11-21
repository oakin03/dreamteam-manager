const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TaskEngine } = require('../src/main/services/task-engine.cjs');

// A Stop pressed while an account is preparing or starting wins (user 2026-11-14).
function engine() {
  const e = Object.create(TaskEngine.prototype);
  e.userStops = new Map();
  e.calls = [];
  e.prepareAccount = async id => { e.calls.push('prepare'); if (e.onPrepare) e.onPrepare(id); };
  e.activatePrepared = async id => { e.calls.push('activate'); if (e.onActivate) e.onActivate(id); return { ok: true }; };
  e.stopAccount = async () => { e.calls.push('stop'); };
  return e;
}

test('start batch: a Stop during preparing stops the account and skips it', async () => {
  const e = engine();
  const since = Date.now() - 10;
  e.onPrepare = id => e.markUserStop([id]);
  const r = await e.startAccount('A', 't', { since });
  assert.equal(r.skipped, true);
  assert.deepEqual(e.calls, ['prepare', 'stop']);
});

test('start batch: a Stop during activation stops it right after', async () => {
  const e = engine();
  const since = Date.now() - 10;
  e.onActivate = id => e.markUserStop([id]);
  const r = await e.startAccount('A', 't', { since });
  assert.equal(r.skipped, true);
  assert.deepEqual(e.calls, ['prepare', 'activate', 'stop']);
});

test('start batch: an account stopped before its turn is not started at all; a click (no since) always starts', async () => {
  const e = engine();
  const since = Date.now() - 10;
  e.markUserStop(['A']);
  assert.equal((await e.startAccount('A', 't', { since })).skipped, true);
  assert.deepEqual(e.calls, []);
  const r = await e.startAccount('A', 't', {});
  assert.equal(r.ok, true);
});
