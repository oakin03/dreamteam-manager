const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitByRole } = require('../src/main/services/split-roles.cjs');
const { CardFactoryMulti } = require('../src/main/services/card-factory-service.cjs');

test('splitByRole: every target gets an even share of each role, and of the total', () => {
  const role = { s1: 'sell', s2: 'sell', s3: 'sell', d1: 'dummy', d2: 'dummy', d3: 'dummy', d4: 'dummy', t1: 'turnuva' };
  const out = splitByRole(Object.keys(role), ['A', 'B'], id => role[id]);
  const count = (t, r) => out[t].filter(id => role[id] === r).length;
  assert.ok(Math.abs(count('A', 'sell') - count('B', 'sell')) <= 1);
  assert.equal(count('A', 'dummy'), 2); assert.equal(count('B', 'dummy'), 2);
  assert.ok(Math.abs(out.A.length - out.B.length) <= 1);
  assert.deepEqual([...out.A, ...out.B].sort(), Object.keys(role).sort());
});

test('Card Factory with several targets: one factory each, sides split by role, an old single save is kept', async () => {
  let saved = { made: 7, config: { targetId: 'T1', sideIds: ['a'], maxPrice: 50, goal: 100, parallel: 3 } };
  const accounts = [{ id: 'T1' }, { id: 'T2' }, { id: 'a', role: 'r1' }, { id: 'b', role: 'r1' }, { id: 'c', role: 'r2' }, { id: 'd', role: 'r2' }].map(a => ({ name: a.id, ...a }));
  const store = { getAccounts: () => accounts, getCardFactory: () => saved, saveCardFactory: v => { saved = v; }, getAccountProfile: () => ({ accounts: {} }), getSettings: () => ({}) };
  const m = new CardFactoryMulti({ store, activity: { add() {} }, onChanged() {} });
  assert.equal(m.snapshot().targets[0].made, 7, 'the old count belongs to its target');
  const started = {};
  for (const tid of ['T1', 'T2']) {
    const c = m._child(tid);
    c.start = async cfg => { started[tid] = cfg.sideIds; return c.snapshot(); };
  }
  await m.start({ targetIds: ['T1', 'T2'], sideIds: ['a', 'b', 'c', 'd'], maxPrice: 50, goal: 100, parallel: 3 });
  assert.equal(started.T1.length, 2); assert.equal(started.T2.length, 2);
  assert.ok(started.T1.some(id => ['a', 'b'].includes(id)) && started.T1.some(id => ['c', 'd'].includes(id)), 'each target gets one of each role');
  assert.equal(saved.multi, true);
  assert.deepEqual(saved.config.targetIds, ['T1', 'T2']);
});
