const test = require('node:test');
const assert = require('node:assert');
const { isCard, isXp, rosterRow, matchOpened, waitMsOf } = require('../src/main/services/bag-service.cjs');
const { isLabor } = require('../src/main/services/labor-service.cjs');

test('Random cards: every A / S kind is a card, X2 EXP and contracts are not', () => {
  for (const n of ['Random A Card', 'Random S Player Card (3D)', 'Random S+ Player Card', 'Random S card', 'Base A Salary Card', 'Base S Salary Card', 'Base Salary S Player Card']) assert.ok(isCard(n), n);
  for (const n of ['X2 EXP(1DAY)', 'Laborer Contract (Normal)', 'Change X Card', 'Strategy Master Card', 'Change Coach Card', 'Dylan Cardwell', 'Gold Base Salary', 'Call back']) assert.ok(!isCard(n), n);
  assert.ok(isXp('X2 EXP(1DAY)'));
});

test('Laborer Contract: both kinds are recognised', () => {
  assert.ok(isLabor('Laborer Contract (Normal)'));
  assert.ok(isLabor('Laborer Contract (Special)'));
  assert.ok(!isLabor('Random A Card'));
});

test('a player from a Random card becomes a row with value, salary and Base', () => {
  const r = rosterRow({ id: 'p1', visualName: 'Walker Kessler', rating: 'S+', position: 'C', baseSalary: 2230, signedSalary: 2119, newBaseSalary: 1136 }, 'Random S Player Card (3D)', Date.parse('2026-11-18T12:00:00Z'));
  assert.deepStrictEqual({ id: r.id, name: r.name, value: r.value, salary: r.salary, base: r.base, source: r.source, listed: r.listed }, { id: 'p1', name: 'Walker Kessler', value: 2230, salary: 2119, base: 1136, source: 'card', listed: false });
});

test('the game\'s "Please wait N seconds" is read as a wait a bit longer than N', () => {
  assert.ok(waitMsOf('Please wait 2 seconds before trying again.') >= 2000);
  assert.strictEqual(waitMsOf('No such item'), 0);
});

test('opened players are found in the roster even when the answer carries another id', () => {
  const before = new Set(['u1', 'u2']);
  const after = [{ id: 'u1', name: 'Old One' }, { id: 'u2', name: 'Old Two' }, { id: 'u3', visualName: 'Bez Mbeng' }, { id: 'u4', visualName: 'Someone Else' }];
  // the answer's id is the catalog id (not in the roster); one answer has no player at all
  const got = [{ item: 'Random S+ Card', player: { id: 'nba-77', visualName: 'Bez Mbeng' } }, { item: 'Random A Card', player: null }];
  const m = matchOpened(got, before, after);
  assert.deepStrictEqual(m.map(x => [x.p.id, x.item]), [['u3', 'Random S+ Card'], ['u4', 'Random A Card']]);
  // an old player with the same name is not taken
  assert.deepStrictEqual(matchOpened([{ item: 'X', player: { visualName: 'Old One' } }], before, after).map(x => x.p.id), ['u3']);
});
