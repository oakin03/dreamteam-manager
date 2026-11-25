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
  assert.equal(service({ levels: { x: 30 }, maxPrice: 50 })._choose({ ours: ['x'] }, 'x', live).player.id, 'b', 'the cheapest whatever its price (2026-11-26)');
  assert.equal(service({ levels: { x: 30 }, autoDraft: { sideOnly: true }, playerRoles: { a: 'card' } })._choose({ ours: ['x'] }, 'x', live), null, 'only Satılabilir / Stok: no card, no cheap player');
});

function liveService(levels, opts = {}) {
  const s = service({ levels, ...opts });
  const joins = [];
  s.draft = {
    slots: opts.slots || [], rooms: new Map(), joined: new Map(),
    attempts: Object.fromEntries(Object.keys(levels).map(id => [id, { draftAttempts: 2 }])),
    join: async (id, slot) => { joins.push([slot, id]); }
  };
  s._roster = async () => ({ total: 5, ids: new Set(), at: Date.now() });
  s.run = { status: 'running', accountIds: Object.keys(levels), rooms: {}, accounts: Object.fromEntries(Object.keys(levels).map(id => [id, { state: 'waiting', picks: [] }])) };
  return { s, joins };
}
const settle = ms => new Promise(r => setTimeout(r, ms));

test('auto draft: a new room gets ONE account at once (every open room); rooms 1-2 and cooling rooms are skipped', async () => {
  const { s, joins } = liveService({ a: 5, b: 6, d: 25, big: 60 }, { slots: [
    { slotNumber: 1, users: [], hasStarted: false, cooldownRemaining: 0 },
    { slotNumber: 3, users: [], hasStarted: false, cooldownRemaining: 0 },
    { slotNumber: 4, users: [], hasStarted: false, cooldownRemaining: 5000 },
    { slotNumber: 5, users: [], hasStarted: false, cooldownRemaining: 0 },
    { slotNumber: 10, users: [], hasStarted: false, cooldownRemaining: 0 }
  ] });
  await s._openRooms();
  await settle(50);
  assert.deepEqual(joins.map(j => j[0]).sort((x, y) => x - y), [3, 5, 10]);
  assert.equal(s.run.rooms[3].ours.length, 1);
});

test('auto draft: N role players → N-1 more accounts; cheap players count only with the option; only Stok counts Stok', async () => {
  const pool = [pl('st', 300), pl('se', 500), pl('ca', 900), pl('c1', 50), pl('c2', 60), pl('x', 400)];
  const roles = { st: 'stok', se: 'sellable', ca: 'card' };
  const levels = { scout: 25, l1: 22, l2: 23, l3: 24, l4: 26, hi: 30 };
  const plan = ({ autoDraft = {} } = {}) => { const { s } = liveService(levels, { playerRoles: roles }); s.saveConfig(autoDraft); return s._extrasPlan({ ours: ['scout'] }, pool, 9); };
  assert.equal(plan({}).extra, 2, '3 role players → 2 more');
  assert.equal(plan({ autoDraft: { cheapAsCard: true, cheapPrice: 70 } }).extra, 4, '+2 players at or under 70 TK');
  assert.equal(plan({ autoDraft: { stokOnly: true } }).extra, 1, 'one Stok: still a Lv30+ account joins for it');
  assert.equal(plan({ autoDraft: { stokOnly: true } }).hiNeed, 1);
  assert.equal(service({ levels }).config().stokOnly, false, 'only Stok is off by default');
});

test('auto draft: the extra accounts include a Lv30 account for the Stok (Lv30 counts as 30+)', async () => {
  const { s, joins } = liveService({ scout: 25, l1: 22, l2: 23, hi: 30 }, { playerRoles: { st: 'stok', se: 'sellable' } });
  s.draft.rooms.set(5, { players: [pl('st', 300), pl('se', 500)], users: [{}], started: false });
  s.run.rooms[5] = { slot: 5, scout: 'scout', ours: ['scout'], extrasDone: false };
  await s._syncRooms();
  await settle(3000);
  assert.deepEqual(joins.map(j => j[1]), ['hi']);
});

test('auto draft: a player in our roster is left to another account; an account with no role player takes the cheapest', () => {
  const { s } = liveService({ a: 25, b: 25 }, { playerRoles: { se: 'sellable' } });
  const live = { players: [pl('se', 500), pl('c1', 80), pl('c2', 40)], picked: [] };
  s.rosterCache.set('a', { total: 5, ids: new Set(['se']), at: Date.now() });
  assert.equal(s._choose({ ours: ['a', 'b'] }, 'b', live).player.id, 'se');
  const forA = s._choose({ ours: ['a', 'b'] }, 'a', live);
  assert.equal(forA.player.id, 'c2', 'the cheapest, not the role player it already has');
  assert.equal(forA.kind, 'cards');
  const { s: s2 } = liveService({ a: 25 }, { autoDraft: { cheapAsCard: true, cheapPrice: 90 } });
  assert.equal(s2._choose({ ours: ['a'] }, 'a', live).player.id, 'c2', 'cheap players: the cheapest first');
});

test('auto draft: an "already signed" answer makes the account pick the next player', async () => {
  const { s } = liveService({ a: 25 }, { playerRoles: { se: 'sellable', sa: 'sellable' } });
  const tried = [];
  const live = { started: true, turn: { userId: 'u-a' }, players: [pl('se', 500), pl('sa', 400)], picked: [] };
  s.draft.rooms.set(5, live);
  s.draft.joined.set('a', { userId: 'u-a' });
  s.draft.pick = async (id, pid) => { tried.push(pid); if (pid === 'se') throw new Error('Player already signed'); };
  s.draft.tagRows = () => {};
  await s._pick({ slot: 5, ours: ['a'] }, 'a');
  assert.deepEqual(tried, ['se', 'sa']);
  assert.equal(s.run.accounts.a.state, 'picked');
});
