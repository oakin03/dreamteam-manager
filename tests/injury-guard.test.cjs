const test = require('node:test');
const assert = require('node:assert');
const { InjuryGuard, isInjuryError, injuredNamesOf, planSwaps } = require('../src/main/services/injury-guard.cjs');

const MSG = 'Cannot start quick play: The following starter players are injured and not healed: Jaxson Hayes, Jusuf Nurkic. Please heal or replace them with healthy players.';
const P = (id, pos, slot, inj, o = 50, extra = {}) => ({ id, visualName: id, position: pos, slot, isInjured: inj, isHealed: false, offense: o, defense: o, __starter: Boolean(slot), ...extra });

test('the injury refusal is recognised and its names are read', () => {
  assert.ok(isInjuryError(MSG));
  assert.ok(!isInjuryError('Cannot start quick play: over the salary cap'));
  assert.deepStrictEqual(injuredNamesOf(MSG), ['Jaxson Hayes', 'Jusuf Nurkic']);
});

test('swap plan: the injured starter goes to the bench, a healthy player of that position comes in', () => {
  const plan = planSwaps([P('a', 'PG', 'PG', false), P('b', 'SG', 'SG', false), P('c', 'SF', 'SF', true), P('d', 'PF', 'PF', false), P('e', 'C', 'C', false), P('x', 'C', null, false, 90), P('y', 'SG/SF', null, false, 40)]);
  assert.deepStrictEqual(plan.swaps.map(w => `${w.out.id}->${w.in.id}`), ['c->y']);
  assert.deepStrictEqual(plan.starters.find(s => s.slot === 'SF'), { playerId: 'y', slot: 'SF' });
  assert.deepStrictEqual(plan.bench.map(b => b.playerId), ['x', 'c']);
});

test('swap plan: no healthy bench player, no plan; a healed player counts as healthy', () => {
  assert.strictEqual(planSwaps([P('a', 'PG', 'PG', true), P('x', 'C', null, true)]), null);
  const healed = P('a', 'PG', 'PG', true, 50, { isHealed: true, healedUntil: new Date(Date.now() + 3600e3).toISOString() });
  assert.strictEqual(planSwaps([healed, P('x', 'C', null, false)]), null);
});

function fakeService({ rosters, swapOk = true }) {
  const logs = [];
  const svc = new InjuryGuard({ store: { getAccounts: () => [{ id: 'A', name: 'Acc' }], getAccountProfile: () => ({ accounts: { A: { userId: 'u1' } } }), getSettings: () => ({}), saveSettings: () => {} }, activity: { add: e => logs.push(e.code) }, sessions: null });
  clearInterval(svc.timer);
  let n = 0;
  svc._roster = async () => rosters[Math.min(n++, rosters.length - 1)];
  svc._swap = async () => swapOk;
  return { svc, logs };
}

test('guard: a refusal is logged once, a swap clears the account at once', async () => {
  const hurtTeam = [P('a', 'PG', 'PG', true), P('x', 'PG', null, false)];
  const { svc, logs } = fakeService({ rosters: [hurtTeam] });
  const fixed = await svc.report('A', MSG, 'Auto Play');
  assert.strictEqual(fixed, true);
  assert.ok(!svc.isBlocked('A'));
  assert.deepStrictEqual(logs, ['inj.blocked', 'inj.cleared']);
});

test('guard: nothing to swap → the account waits, the same refusal is not logged again, waitClear resolves once healed', async () => {
  const hurtTeam = [P('a', 'PG', 'PG', true)];
  const { svc, logs } = fakeService({ rosters: [hurtTeam], swapOk: false });
  assert.strictEqual(await svc.report('A', MSG, 'Auto Play'), false);
  assert.strictEqual(await svc.report('A', MSG, 'Go-up'), false);
  assert.ok(svc.isBlocked('A'));
  assert.strictEqual(logs.filter(c => c === 'inj.blocked').length, 1);
  const waiting = svc.waitClear('A');
  svc._clear('A');
  assert.strictEqual(await waiting, true);
});

// ---------- a new player for an injured starter (user 2026-11-24) ----------
const { EventEmitter } = require('node:events');
function replaceWorld() {
  const calls = [];
  const sal = (id, pos, slot, salary, extra = {}) => ({ id, visualName: id, position: pos, signedSalary: salary, baseSalary: salary, ...extra });
  const starters = [sal('pg', 'PG', 'PG', 1000), sal('sg', 'SG', 'SG', 1000), sal('hurt', 'SF', 'SF', 900, { isInjured: true }), sal('pf', 'PF', 'PF', 1000), sal('c', 'C', 'C', 1000)];
  const bench = [sal('b1', 'C', null, 300)];
  const boards = {
    u1: [{ id: 'own-sf', name: 'Own SF', position: 'SF/PF', baseSalary: 1200 }, { id: 'too-dear', name: 'Too Dear', position: 'SF', baseSalary: 2000 }, { id: 'wrong-pos', name: 'Wrong', position: 'PG', baseSalary: 1600 }],
    u2: [{ id: 'other-sf', name: 'Other SF', position: 'SF', baseSalary: 1500 }, { id: 'hurt-sf', name: 'Hurt SF', position: 'SF', baseSalary: 1650, isInjured: true }]
  };
  const createSocket = () => {
    const s = new EventEmitter();
    s.off = s.removeListener; s.connected = true;
    s.close = () => { s.closed = true; };
    const local = EventEmitter.prototype.emit.bind(s);
    const reply = (name, data) => setTimeout(() => !s.closed && local(name, data), 1);
    s.emit = (event, payload) => {
      calls.push({ event, payload });
      if (event === 'getUserBasicInfo') reply('userBasicInfo', { salaryCap: 6000, funds: 50000 });
      if (event === 'market:sellPlayer') reply('market:sellResult', { success: true });
      if (event === 'getUserInventory') reply('userInventoryData', []);
      return true;
    };
    s.timeout = () => ({ emit: (event, payload, cb) => {
      calls.push({ event, payload });
      let r = { success: true };
      if (event === 'getTeamOptimized') r = { players: { starters, bench } };
      if (event === 'getFreeAgent') r = { freeAgents: boards[payload.userId] || [] };
      if (event === 'getUserActiveMatch') r = { success: true, match: null };
      setTimeout(() => cb(null, r), 1);
    } });
    setTimeout(() => local('connect'), 1);
    return s;
  };
  const friends = { befriended: [], signed: [] };
  const friendNet = { friendsOf: async () => ({ ids: new Set() }), board: async () => null, _befriend: async (a, b) => friends.befriended.push([a, b]), signFrom: async (a, u, pid) => { friends.signed.push([a, u, pid]); return { success: true }; } };
  const settings = {};
  const logs = [];
  const svc = new InjuryGuard({
    store: { getAccounts: () => [{ id: 'A', name: 'Acc' }, { id: 'B', name: 'Other' }], getAccountProfile: () => ({ accounts: { A: { userId: 'u1' }, B: { userId: 'u2' } } }), getSettings: () => settings, saveSettings: v => Object.assign(settings, v) },
    activity: { add: e => logs.push(e.code) }, sessions: { get: async () => ({ userId: 'u1', cookieHeader: 'c=1' }) }, createSocket, friendNet
  });
  clearInterval(svc.timer);
  return { svc, calls, friends, settings, logs };
}

test('replace: the most expensive healthy player of that position within the cap (injured salary off); our other account becomes a friend first; the injured one waits at 999999 TIX', async () => {
  const { svc, calls, friends, settings, logs } = replaceWorld();
  const r = await svc.replace(['A'], 'park');
  // room = 6000 − (5200 − 900) = 1700: Other SF (1500) beats Own SF (1200); Too Dear, the PG and the injured one are left out
  assert.deepStrictEqual(friends.befriended, [['A', 'B']]);
  assert.deepStrictEqual(friends.signed, [['A', 'u2', 'other-sf']]);
  const sell = calls.find(c => c.event === 'market:sellPlayer');
  assert.deepStrictEqual([sell.payload.playerId, sell.payload.price, sell.payload.paymentMode], ['hurt', 999999, 'TICKET']);
  const lineup = calls.filter(c => c.event === 'updatePlayerPositions').pop();
  assert.ok(lineup.payload.starters.some(s => s.playerId === 'other-sf' && s.slot === 'SF'), 'the new one plays SF');
  assert.deepStrictEqual(settings.injuryParked.map(p => [p.playerId, p.replacedBy]), [['hurt', 'Other SF']]);
  assert.ok(logs.includes('inj.replaced'));
  assert.ok(!calls.some(c => c.event === 'register'), 'nobody is signed out: no register');
  assert.ok(r.results.A);
});
