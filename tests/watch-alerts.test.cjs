const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watchAlerts } = require('../src/main/services/watch-alerts.cjs');
const { AccountHealth } = require('../src/main/services/account-health.cjs');

test('watch alerts: a watched player that fell to Base or lost ≥10% is reported; others not', () => {
  const players = [
    { id: 'a', name: 'A', value: 50, base: 50, previous: 52, change: -2, isBase: true },
    { id: 'b', name: 'B', value: 90, base: 40, previous: 100, change: -10, isBase: false },
    { id: 'c', name: 'C', value: 95, base: 40, previous: 100, change: -5, isBase: false },
    { id: 'd', name: 'D', value: 10, base: 10, previous: 20, change: -10, isBase: true }
  ];
  const prev = new Map([['a', { isBase: false }], ['d', { isBase: true }]]);
  const watch = ['a', 'b', 'c'].map(id => ({ playerId: id }));
  assert.deepEqual(watchAlerts(watch, players, prev).map(h => [h.name, h.becameBase, h.dropped]), [['A', true, false], ['B', false, true]]);
});

test('account health issues: over the cap first, near cap, roster full, low TK, Auto Play error', () => {
  const kinds = r => AccountHealth.issues(r, { status: 'error' }).map(i => i.kind);
  assert.deepEqual(kinds({ cap: 7000, used: 7100, roster: 11, tk: 100 }), ['overCap', 'rosterFull', 'lowTk', 'autoPlayError']);
  assert.deepEqual(AccountHealth.issues({ cap: 7000, used: 6900, roster: 8, tk: 90000 }, null).map(i => i.kind), ['nearCap']);
  assert.deepEqual(AccountHealth.issues({ cap: 7000, used: 5000, roster: 8, tk: 90000 }, { status: 'running' }), []);
});

test('account health limits: saved values replace the defaults, bad values fall back', () => {
  const { healthLimits } = require('../src/main/services/account-health.cjs');
  const limits = healthLimits({ lowTk: 10000, nearCapPct: 90, rosterWarn: 10 });
  const kinds = r => AccountHealth.issues(r, null, limits).map(i => i.kind);
  assert.deepEqual(kinds({ cap: 7000, used: 6400, roster: 10, tk: 8000 }), ['nearCap', 'rosterFull', 'lowTk']);
  assert.deepEqual(healthLimits({ lowTk: 'x', nearCapPct: 300, rosterWarn: 0 }), { lowTk: 5000, nearCapPct: 97, rosterWarn: 11 });
  assert.deepEqual(healthLimits(null), { lowTk: 5000, nearCapPct: 97, rosterWarn: 11 });
});
