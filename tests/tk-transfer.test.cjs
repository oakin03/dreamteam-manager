const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWorld, player } = require('./fake-trade-game.cjs');
const { TkTransferService, pickListings } = require('../src/main/services/tk-transfer-service.cjs');

function setup(users) {
  const { world, createSocket } = createWorld(users);
  const logs = [];
  let settings = {};
  const accounts = Object.keys(users).map(id => ({ id, name: users[id].name || id }));
  const store = { getAccounts: () => accounts, getSettings: () => settings, saveSettings: v => { settings = v; } };
  const sessions = { get: async account => ({ userId: account.id, cookieHeader: 'c=1' }) };
  const svc = new TkTransferService({ store, activity: { add: e => logs.push(e) }, sessions, createSocket, timing: { buyGapMs: 0 } });
  return { world, svc, logs, settings: () => settings };
}
const listing = (id, salary, price) => ({ player: player(id, salary, { name: id }), price });

test('picks the side listings main may buy: APK, price, salary, not owned, one copy, within the side TK', () => {
  const t = (playerId, salary, price, extra = {}) => ({ ticketId: 'x' + playerId + price, playerId, name: playerId, salary, price, currency: 'APK', status: 'LISTED', ...extra });
  const picks = pickListings([
    t('a', 900, 40), t('a', 900, 30), t('b', 100, 20), t('c', 700, 60), t('d', 500, 20, { currency: 'TIX' }),
    t('e', 600, 20), t('f', 800, 20), t('g', 300, 20, { status: 'SOLD' }), t('h', 400, 20)
  ], { minSalary: 200, maxApk: 50, mainOwned: new Set(['f']), count: 5, sideFunds: 1600 });
  assert.deepEqual(picks.map(p => p.playerId), ['a', 'e']); // a 900 + e 600 = 1500; h 400 would pass 1600
});

test('TK transfer buys from the richest side that can pay, trades back, relists and stops after the target', async () => {
  const { world, svc, logs, settings } = setup({
    main: { name: 'Main', funds: 100, apk: 1000 },
    poor: { name: 'Poor', funds: 700, market: [listing('q1', 800, 25)] },
    rich: { name: 'Rich', funds: 5000, market: [listing('p1', 600, 30), listing('p2', 500, 30), listing('p3', 100, 30), listing('p4', 700, 999)] }
  });
  await svc.runAndWait({ mainId: 'main', sideIds: ['poor', 'rich'], minSalary: 200, maxApk: 50, targetTk: 2500 });
  const r = settings().tkTransferReport;
  assert.equal(r.reason, 'target');
  assert.equal(r.transferred, 3300);           // 3 rounds × (600 + 500)
  assert.equal(r.apkSpent, 180);
  assert.equal(world.users.main.funds, 3400);
  assert.equal(world.users.rich.funds, 1700);
  assert.equal(world.users.poor.funds, 700, 'the side without enough TK is skipped');
  assert.equal(world.users.main.bench.length, 0, 'main keeps none of the bought players');
  const listed = world.tickets.filter(t => t.sellerId === 'rich' && t.status === 'LISTED').map(t => [t.playerId, t.price]).sort();
  assert.deepEqual(listed, [['p1', 30], ['p2', 30], ['p3', 30], ['p4', 999]]);
  assert.ok(world.users.rich.apk > 0, 'the side claimed its sales');
  assert.ok(logs.some(l => l.code === 'tk.doneTarget'));
  assert.equal(r.items.length, 6, 'every bought player is listed with its round');
  assert.deepEqual([...new Set(r.items.map(i => i.status))], ['relisted']);
  assert.deepEqual(r.items.slice(0, 2).map(i => [i.round, i.side, i.name]), [[3, 'Rich', 'p1'], [3, 'Rich', 'p2']]);
});

test('TK transfer stops with an APK warning when main cannot pay any more', async () => {
  const { svc, logs, settings } = setup({
    main: { name: 'Main', funds: 0, apk: 50 },
    side: { name: 'Side', funds: 9000, market: [listing('p1', 600, 30), listing('p2', 500, 30)] }
  });
  await svc.runAndWait({ mainId: 'main', sideIds: ['side'], minSalary: 0, maxApk: 40, targetTk: 99999 });
  const r = settings().tkTransferReport;
  assert.equal(r.reason, 'apk');
  assert.equal(r.transferred, 600);
  assert.ok(logs.some(l => l.code === 'tk.apkOut'));
});

test('TK transfer refuses values outside the allowed ranges', async () => {
  const { svc } = setup({ main: {}, side: {} });
  await assert.rejects(svc.runAndWait({ mainId: 'main', sideIds: ['side'], minSalary: 3000, maxApk: 30, targetTk: 10 }), /0 and 2500/);
  await assert.rejects(svc.runAndWait({ mainId: 'main', sideIds: ['side'], minSalary: 100, maxApk: 10, targetTk: 10 }), /at least 20/);
  await assert.rejects(svc.runAndWait({ mainId: 'main', sideIds: [], minSalary: 100, maxApk: 30, targetTk: 10 }), /side account/);
});
