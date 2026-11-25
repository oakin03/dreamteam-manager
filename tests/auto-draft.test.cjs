const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoDraftService } = require('../src/main/services/auto-draft.cjs');

// The picking rules of the automatic Draft (user 2026-11-24).
const ROLES = [{ id: 'sellable', name: 'Satılabilir' }, { id: 'card', name: 'Kart' }, { id: 'stok', name: 'Stok' }];
function service({ levels = {}, autoDraft = {}, roles = ROLES, playerRoles = {}, maxPrice = 100 } = {}) {
  const settings = { autoDraft };
  return new AutoDraftService({
    store: {
      getAccounts: () => Object.keys(levels).map(id => ({ id, name: id })),
      getAccountProfile: () => ({ accounts: Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, { level, userId: 'u-' + id }])) }),
      getCardRoles: () => roles,
      getCardMetadata: () => ({ players: Object.fromEntries(Object.entries(playerRoles).map(([pid, r]) => ['id:' + pid, { roleIds: [r] }])) }),
      getSettings: () => settings, saveSettings: s => Object.assign(settings, s)
    },
    activity: { add() {} }, draft: {}, atConfig: () => ({ maxPrice, mainToSideRoleIds: ['sellable', 'stok'], sideToMainRoleIds: ['card'] })
  });
}
const pl = (id, price) => ({ id, name: id, baseSalary: price, signed: false });

test('auto draft: Stok, then Satılabilir, then Kart by default; a new role joins the priority at the end', () => {
  const s = service({ roles: [...ROLES, { id: 'new', name: 'Yeni' }] });
  assert.deepEqual(s.config().priority, ['stok', 'sellable', 'card', 'new']);
});

test('auto draft: the best player by priority; Stok is left for a Lv30+ account still to pick', () => {
  const s = service({ levels: { low: 20, high: 35 }, playerRoles: { st: 'stok', se: 'sellable', ca: 'card' } });
  const live = { players: [pl('ca', 900), pl('se', 500), pl('st', 300)], picked: [] };
  const room = { ours: ['low', 'high'] };
  assert.equal(s._choose(room, 'low', live).player.id, 'se', 'the Lv20 account leaves the Stok');
  assert.equal(s._choose(room, 'high', live).player.id, 'st', 'the Lv35 account takes the Stok');
  // no Lv30+ account left to pick: the lower one takes it
  assert.equal(s._choose({ ours: ['low'] }, 'low', live).player.id, 'st');
  assert.equal(s._choose(room, 'high', live).kind, 'spender');
  assert.equal(s._choose({ ours: ['high'] }, 'high', { players: [pl('ca', 900)] }).kind, 'cards');
});

test('auto draft: a room with no role player — the cheapest under the cheap price (cards / fire / nothing)', () => {
  const live = { players: [pl('a', 400), pl('b', 60), pl('c', 90)] };
  assert.equal(service({ levels: { x: 30 } })._choose({ ours: ['x'] }, 'x', live).player.id, 'b');
  assert.equal(service({ levels: { x: 30 }, autoDraft: { fallback: 'fire' } })._choose({ ours: ['x'] }, 'x', live).kind, 'fire');
  assert.equal(service({ levels: { x: 30 }, autoDraft: { fallback: 'none' } })._choose({ ours: ['x'] }, 'x', live), null);
  assert.equal(service({ levels: { x: 30 }, maxPrice: 50 })._choose({ ours: ['x'] }, 'x', live), null, 'none under the cheap price');
  assert.equal(service({ levels: { x: 30 }, autoDraft: { sideOnly: true }, playerRoles: { a: 'card' } })._choose({ ours: ['x'] }, 'x', live), null, 'only Satılabilir / Stok: no card, no cheap player');
});

test('auto draft: every open room is filled with as many fitting accounts as it has free seats', async () => {
  const levels = { a: 5, b: 6, c: 7, d: 25, e: 26, big: 60 };
  const s = service({ levels });
  const joins = [];
  s.draft = {
    slots: [
      { slotNumber: 1, users: [], hasStarted: false, cooldownRemaining: 0 },             // Rookie: closed
      { slotNumber: 3, users: [{ userId: 'x' }], hasStarted: false, cooldownRemaining: 0 }, // Lv1-20
      { slotNumber: 4, users: [], hasStarted: false, cooldownRemaining: 5000 },           // cooling down
      { slotNumber: 5, users: [], hasStarted: false, cooldownRemaining: 0 },              // Lv21-30
      { slotNumber: 10, users: [], hasStarted: false, cooldownRemaining: 0 }              // Lv51-70
    ],
    rooms: new Map(), joined: new Map(), attempts: Object.fromEntries(Object.keys(levels).map(id => [id, { draftAttempts: 2 }])),
    join: async (id, slot) => { joins.push([slot, id]); }
  };
  s._rosterTotal = async () => 5;
  s.run = { status: 'running', accountIds: Object.keys(levels), rooms: {}, accounts: Object.fromEntries(Object.keys(levels).map(id => [id, { state: 'waiting', picks: [] }])) };
  await s._openRooms();
  await new Promise(r => setTimeout(r, 6000)); // joins are spaced 0.9-2.2 s
  const bySlot = slot => joins.filter(j => j[0] === slot).map(j => j[1]).sort();
  assert.deepEqual(bySlot(3), ['a', 'b', 'c']);
  assert.deepEqual(bySlot(5), ['d', 'e']);
  assert.deepEqual(bySlot(10), ['big']);
  assert.equal(joins.filter(j => j[0] === 1 || j[0] === 4).length, 0);
  assert.equal(s.run.rooms[3].ours.length, 3);
});
