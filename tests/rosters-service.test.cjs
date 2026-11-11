const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RostersService } = require('../src/main/services/rosters-service.cjs');

test('rosters: every account read anonymously, starters then bench, a failing account listed', async () => {
  const rosters = {
    ua: { starters: [{ id: 'p1', name: 'Alperen Sengun', position: 'C', rating: 'S+', team: 'HOU', baseSalary: 2380, lastSalary: 2300, newBaseSalary: 1278, signedSalary: 1350, slot: 'C' }], bench: [{ id: 'p2', name: 'Bench Guy', rating: 'C', baseSalary: 50, lastSalary: 60, benchSlot: 1, type: 'XPLAYER' }] },
    ub: null
  };
  const calls = [];
  const createSocket = (_u, options) => {
    const s = new EventEmitter(); s.off = s.removeListener; s.close = () => {};
    calls.push(Boolean(options.extraHeaders));
    s.timeout = () => ({ emit: (event, p, cb) => setTimeout(() => cb(null, rosters[p.userId] ? { players: rosters[p.userId] } : { success: false }), 1) });
    setTimeout(() => EventEmitter.prototype.emit.call(s, 'connect'), 1);
    return s;
  };
  let saved = null;
  const store = {
    getAccounts: () => [{ id: 'a', name: 'Trophy' }, { id: 'b', name: 'Broken' }, { id: 'c', name: 'NoUser' }],
    getAccountProfile: () => ({ accounts: { a: { userId: 'ua', level: 34 }, b: { userId: 'ub' } } }),
    getRostersData: () => saved, saveRostersData: v => { saved = v; }
  };
  const svc = new RostersService({ store, activity: { add() {} }, createSocket });
  await svc.refresh();
  const snap = svc.snapshot();
  assert.deepEqual(snap.rows.map(r => [r.account, r.group, r.name, r.change, r.x]), [['Trophy', 'starter', 'Alperen Sengun', 80, false], ['Trophy', 'bench', 'Bench Guy', -10, true]]);
  assert.equal(snap.rows[0].level, 34);
  assert.deepEqual(snap.failed.map(f => f.name), ['Broken']);
  assert.ok(calls.every(c => !c), 'no cookie: anonymous sockets only');
  assert.equal(snap.busy, null);
});
