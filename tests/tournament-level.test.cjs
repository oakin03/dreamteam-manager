const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TournamentLevelService, planSwaps } = require('../src/main/services/tournament-level-service.cjs');

const ev = (id, min, max, userIds, status = 'REGISTRATION') => ({ id, name: id, type: 'TICKET_MATCH', status, minLevel: min, maxLevel: max, maxPlayers: 128, count: userIds.length, userIds: new Set(userIds) });
const acc = n => ({ id: n, name: n, userId: 'u-' + n });

test('plan: wrong-level accounts are paired with fitting accounts not in the tournament, in order; the rest stay', () => {
  const accounts = ['A', 'B', 'C', 'D', 'E'].map(acc);
  const levels = new Map([['u-A', 20], ['u-B', 25], ['u-C', 15], ['u-D', 12], ['u-E', 18]]);
  const plan = planSwaps([ev('t10', 10, 19, ['u-A', 'u-B', 'u-C']), ev('closed', 10, 19, ['u-A'], 'ONGOING')], accounts, levels);
  assert.equal(plan.length, 1, 'only open tournaments');
  assert.deepEqual(plan[0].wrong.map(a => a.id), ['A', 'B']);
  assert.deepEqual(plan[0].pairs.map(p => [p.out.id, p.in.id]), [['A', 'D'], ['B', 'E']]);
  const few = planSwaps([ev('t10', 10, 19, ['u-A', 'u-B', 'u-C', 'u-D'])], accounts, levels);
  assert.deepEqual(few[0].pairs.map(p => [p.out.id, p.in.id]), [['A', 'E']]);
  assert.deepEqual(few[0].stay.map(a => a.id), ['B'], 'no fitting account left: B stays registered');
});

test('swap: the wrong account quits, then the fitting one registers right away on its own cookie', async () => {
  const calls = [];
  const events = [{ id: 't10', name: 'Rookie Ticket', type: 'TICKET_MATCH', status: 'REGISTRATION', minLevel: 10, maxLevel: 19, maxPlayers: 128, _count: { registrations: 2 }, registrations: [{ userId: 'u-A' }, { userId: 'u-C' }] }];
  const levels = { 'u-A': 21, 'u-B': 14, 'u-C': 12 };
  const createSocket = (_url, options) => {
    const s = new EventEmitter(); s.off = s.removeListener; s.close = () => {}; s.connected = false;
    const local = EventEmitter.prototype.emit.bind(s);
    const cookie = options.extraHeaders?.Cookie || null;
    s.emit = (event, payload) => { if (event === 'getMatchUserData') setTimeout(() => local('matchUserData', { success: true, level: levels[payload.userId] }), 1); return true; };
    s.timeout = () => ({ emit: (event, ...args) => {
      const cb = args.pop(); const p = args[0];
      calls.push([event, cookie, p?.userId || null]);
      const r = event === 'getActiveMultiplayerEvents' ? events : { success: true, eventId: p?.eventId };
      setTimeout(() => cb(null, r), 1);
    } });
    setTimeout(() => { s.connected = true; local('connect'); }, 1);
    return s;
  };
  const accounts = ['A', 'B', 'C'].map(n => ({ id: n, name: n }));
  const store = { getAccounts: () => accounts, getAccountProfile: () => ({ accounts: Object.fromEntries(accounts.map(a => [a.id, { userId: 'u-' + a.id }])) }), getSettings: () => ({}) };
  const tournament = { _login: async a => ({ userId: 'u-' + a.id, cookieHeader: 'c-' + a.id }), snapshot: () => ({ runtime: { status: 'idle' } }) };
  const logs = [];
  const svc = new TournamentLevelService({ store, activity: { add: e => logs.push(e) }, tournament, createSocket });
  await svc.check({ swap: false });
  assert.ok(!calls.some(c => c[0] === 'quitMultiplayer'), 'Check alone never quits');
  assert.equal(svc.snapshot().rows[0].wrong[0].name, 'A');
  await svc.check({ swap: true });
  const writes = calls.filter(c => ['quitMultiplayer', 'registerMultiplayer'].includes(c[0]));
  assert.deepEqual(writes, [['quitMultiplayer', 'c-A', 'u-A'], ['registerMultiplayer', 'c-B', 'u-B']]);
  assert.ok(svc.snapshot().swaps[0].ok);
  assert.ok(logs.some(l => l.code === 'tl.swapped'));
});
