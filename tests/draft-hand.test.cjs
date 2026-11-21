const test = require('node:test');
const assert = require('node:assert/strict');
const { DraftService } = require('../src/main/services/draft-service.cjs');
const { createWorld, player } = require('./fake-trade-game.cjs');

// Draft's drafted-players table: Kov / Tümünü kov / Karta çevir (user 2026-11-11)
function setup(users, drafted) {
  const { world, createSocket } = createWorld(users);
  const logs = [];
  let data = { drafted };
  const accounts = Object.keys(users).map(id => ({ id, name: users[id].name || id }));
  const store = {
    getAccounts: () => accounts,
    getAccountProfile: () => ({ mainAccountId: 'M', accounts: Object.fromEntries(accounts.map(a => [a.id, { userId: a.id }])) }),
    getDraftData: () => data, saveDraftData: v => { data = JSON.parse(JSON.stringify(v)); },
    getSettings: () => ({}), saveSettings() {}
  };
  const draft = new DraftService({ store, activity: { add: e => logs.push(e) }, sessions: { get: async a => ({ userId: a.id, cookieHeader: 'c' }) }, onChanged() {}, createSocket });
  return { draft, world, logs, data: () => data };
}
const row = (id) => ({ id, name: id, value: 100, listed: false, at: '2026-11-11T10:00:00Z' });

test('draft: Tümünü kov fires the drafted players and drops them from the list', async () => {
  const { draft, world, data } = setup({ M: {}, S: { bench: [player('d1', 100), player('d2', 100)] } }, { S: [row('d1'), row('d2')] });
  await draft.firePlayers('S', ['d1', 'd2']);
  assert.deepEqual(world.users.S.fired, ['d1', 'd2']);
  assert.equal(data().drafted.S, undefined);
});

test('draft: Karta çevir gives the players to main in a trade and makes cards there', async () => {
  const { draft, world, data, logs } = setup({ M: {}, S: { bench: [player('d1', 100), player('d2', 100)] } }, { S: [row('d1'), row('d2')] });
  await draft.toCards('S', ['d1']);
  assert.deepEqual(world.users.M.made, ['d1']);
  assert.ok(!world.users.S.bench.some(p => p.id === 'd1'));
  assert.deepEqual(data().drafted.S.map(p => p.id), ['d2']);
  assert.ok(logs.some(l => l.code === 'df.carded'));
});

test('draft: a drafted player of main itself is only made into a card', async () => {
  const { draft, world, data } = setup({ M: { bench: [player('d1', 100)] } }, { M: [row('d1')] });
  await draft.toCards('M', ['d1']);
  assert.deepEqual(world.users.M.made, ['d1']);
  assert.equal(data().drafted.M, undefined);
  assert.ok(!world.calls.some(c => c.event === 'createTradeRoom'));
});

test('draft: prices come from the given pricing, queued rows are listed and handed rows leave', () => {
  const { draft, data } = setup({ M: {}, S: { bench: [player('d1', 100), player('d2', 100)] } }, { S: [row('d1'), row('d2')] });
  draft.priceOf = r => (r.id === 'd1' ? { price: 777, currency: 'TIX' } : null);
  const snap = draft.snapshot();
  assert.deepEqual(snap.drafted.S.find(p => p.id === 'd1').suggest, { price: 777, currency: 'TIX' });
  assert.equal(snap.drafted.S.find(p => p.id === 'd2').suggest, undefined);
  draft.queueCards('S', ['d2']);
  assert.deepEqual(draft.queuedCards(), { S: ['d2'] });
  draft.handedToAutoTrade('S', ['d1']);
  assert.deepEqual(data().drafted.S.map(p => p.id), ['d2']);
  draft.queueCards('S', ['d2'], false);
  assert.deepEqual(draft.queuedCards(), {});
});
