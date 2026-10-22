const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/main/services/trade-rules.cjs');

const roles = R.roleMapFrom({ players: { 'id:castle': { roleIds: ['sellable'] }, 'id:sorber': { roleIds: ['card'] }, 'id:stock': { roleIds: ['role-stok'] }, 'slug:old': { roleIds: ['card'] } } });
const cfg = { sideToMainRoleIds: ['card'], mainToSideRoleIds: ['sellable', 'role-stok'], maxPrice: 100 };
const p = (id, baseSalary, extra = {}) => ({ id, name: id, baseSalary, signedSalary: baseSalary, ...extra });

test('classify: price ≤ limit always goes to main, then roles; under 50 the price rule is off', () => {
  assert.equal(R.classify(p('castle', 1345), cfg, roles), 'side');
  assert.equal(R.classify(p('castle', 90), cfg, roles), 'main', 'price rule wins over the Satılabilir role');
  assert.equal(R.classify(p('sorber', 900), cfg, roles), 'main');
  assert.equal(R.classify(p('stock', 600), cfg, roles), 'side');
  assert.equal(R.classify(p('nobody', 600), cfg, roles), null);
  assert.equal(R.classify(p('nobody', 100), cfg, roles), 'main', '100 is included');
  assert.equal(R.classify(p('nobody', 50), { ...cfg, maxPrice: 49 }, roles), null, 'limit < 50 → roles only');
  assert.equal(R.classify(p('nobody', 2500), { ...cfg, maxPrice: 2500 }, roles), 'main');
  assert.equal(R.normalizeConfig({ maxPrice: -5 }).maxPrice, 0);
  assert.equal(R.normalizeConfig({ maxPrice: 9000 }).maxPrice, 2500);
});

test('tradeBlock: starters, X, temporary and equipped players are never traded', () => {
  assert.equal(R.tradeBlock(p('a', 50, { slot: 'PG' })), 'starter');
  assert.equal(R.tradeBlock(p('a', 50, { type: 'XPLAYER', benchSlot: 1 })), 'x');
  assert.equal(R.tradeBlock(p('a', 50, { isTemporary: true })), 'temporary');
  assert.equal(R.tradeBlock(p('a', 50, { equippedItems: { jersey: null, shoes: { id: 'i' } } })), 'equipped');
  assert.equal(R.tradeBlock(p('a', 50, { benchSlot: 2, equippedItems: { jersey: null } })), null);
});

const roster = (n, ids = []) => ({ total: n, ids: new Set(ids) });

test('planTrade: at most 5 each way, never over 11, duplicates left out', () => {
  const sideGive = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => p(id, 50));
  // Main has 8 players → only 3 can come in.
  let plan = R.planTrade({ mainRoster: roster(8), sideRoster: roster(11), mainGive: [], sideGive });
  assert.deepEqual(plan.sideGives.map(x => x.id), ['a', 'b', 'c']);
  // Main gives 2 back in the same trade → 5 fit.
  plan = R.planTrade({ mainRoster: roster(8), sideRoster: roster(11), mainGive: [p('m1', 60), p('m2', 60)], sideGive });
  assert.deepEqual([plan.mainGives.length, plan.sideGives.length], [2, 5]);
  // Side is full and gives nothing → main cannot give.
  plan = R.planTrade({ mainRoster: roster(11), sideRoster: roster(11), mainGive: [p('m1', 60)], sideGive: [] });
  assert.equal(plan.empty, true);
  // Duplicates
  plan = R.planTrade({ mainRoster: roster(6, ['b']), sideRoster: roster(7, ['m1']), mainGive: [p('m1', 60), p('m2', 60)], sideGive: [p('a', 50), p('b', 50)] });
  assert.deepEqual([plan.mainGives.map(x => x.id), plan.sideGives.map(x => x.id), plan.dupToSide.map(x => x.id), plan.dupToMain.map(x => x.id)], [['m2'], ['a'], ['m1'], ['b']]);
});

test('planTrade: TK is the salary difference, checked against who pays', () => {
  // The user's example: main gives 1×60, side gives 5×50 → main pays 190.
  const plan = R.planTrade({ mainRoster: roster(6), sideRoster: roster(11), mainGive: [p('m', 60)], sideGive: [1, 2, 3, 4, 5].map(i => p('s' + i, 50)), mainFunds: 100 });
  assert.equal(plan.tk, 190);
  assert.equal(plan.mainCanPay, false);
  const back = R.planTrade({ mainRoster: roster(11), sideRoster: roster(6), mainGive: [p('m', 1345)], sideGive: [], sideFunds: 500 });
  assert.equal(back.tk, -1345);
  assert.equal(back.sideCanPay, false);
});

test('sideOrder and tradeFailure', () => {
  assert.deepEqual(R.sideOrder([{ id: 'a', funds: 10 }, { id: 'b', funds: 90 }, { id: 'c', funds: 50 }]).map(s => s.id), ['b', 'c', 'a']);
  assert.equal(R.tradeFailure('Trade failed: guest would end up with duplicate players.'), 'dupToGuest');
  assert.equal(R.tradeFailure('Trade failed: host would end up with duplicate players.'), 'dupToHost');
  assert.equal(R.tradeFailure('Trade failed: one or more selected players has equipped items.'), 'equipped');
  assert.equal(R.tradeFailure('Trade would exceed max player limit (11)'), 'rosterFull');
});

test('base as sellable uses the Cards team, including teams the user gave or took away', () => {
  const cards = { players: { 'id:a': { playerId: 'a', team: 'BOS' }, 'id:b': { playerId: 'b', team: 'No Team', noTeam: true }, 'id:c': { playerId: 'c', team: 'LAL' } } };
  const meta = { players: { 'id:b': { customTeam: 'LAL' }, 'id:c': { customTeam: 'NONE' } } };
  const team = R.teamPlayersFrom(cards, meta);
  assert.deepEqual([...team].sort(), ['a', 'b']);
  const base = id => ({ id, baseSalary: 50, signedSalary: 48, newBaseSalary: 50 });
  const c2 = { ...cfg, baseAsSellable: true };
  assert.equal(R.classify(base('a'), c2, roles, team), 'side');
  assert.equal(R.classify(base('b'), c2, roles, team), 'side', 'No Team player given LAL counts');
  assert.equal(R.classify(base('c'), c2, roles, team), 'main', 'taken out of LAL → normal rules (price ≤ 100)');
  assert.equal(R.classify({ ...base('a'), signedSalary: 51 }, c2, roles, team), 'main', 'above Base → normal rules');
  // Projected Base (default): 50 at Base 50 is not Base, because tomorrow's Base is 48.
  assert.equal(R.nextBase(50), 48);
  assert.equal(R.classify({ ...base('a'), signedSalary: 50 }, c2, roles, team), 'main', "salary = today's Base → not Base tomorrow");
  assert.equal(R.classify({ ...base('a'), signedSalary: 50 }, { ...c2, baseProjected: false }, roles, team), 'side', "today's Base when projection is off");
  assert.equal(R.salaryAtBase({ signedSalary: 48, newBaseSalary: 48 }), true);
  assert.equal(R.salaryAtBase({ signedSalary: 48, newBaseSalary: 48 }, { projected: true }), false);
});
