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
