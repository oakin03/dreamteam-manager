const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ApkTransferService, planTransfers } = require('../src/main/services/apk-transfer-service.cjs');
const { createWorld, player } = require('./fake-trade-game.cjs');
const { FriendNetwork } = require('../src/main/services/friend-network.cjs');

function setup(users, { roles = {}, accountRoles = {} } = {}) {
  const { world, createSocket } = createWorld(users);
  const logs = [];
  const ids = Object.keys(users);
  const accs = ids.map(id => ({ id, name: users[id].name || id, ...(accountRoles[id] ? { role: accountRoles[id] } : {}) }));
  let settings = {};
  const store = {
    getAccounts: () => accs,
    getAccountProfile: () => ({ mainAccountId: 'M', accounts: Object.fromEntries(ids.map(id => [id, { userId: id }])) }),
    getCardMetadata: () => ({ players: Object.fromEntries(Object.entries(roles).map(([pid, r]) => [`id:${pid}`, { roleIds: [].concat(r) }])) }),
    getSettings: () => settings, saveSettings: v => { settings = v; }
  };
  const sessions = { get: async a => ({ userId: a.id, cookieHeader: 'c' }) };
  const friendNet = new FriendNetwork({ store, sessions, createSocket, activity: { add: e => logs.push(e) }, onChanged() {} });
  const profile = {};
  const accountProfile = { merge: (id, patch) => { profile[id] = { ...(profile[id] || {}), ...patch }; } };
  const svc = new ApkTransferService({ store, activity: { add: e => logs.push(e) }, sessions, friendNet, accountProfile, createSocket, onChanged() {}, timing: { gapMs: 0 } });
  return { world, svc, logs, settings: () => settings, profile };
}

test('plan: one transfer per side and currency at its whole balance; under the minimum or a full roster is skipped', () => {
  const { transfers, skipped } = planTransfers([
    { id: 'A', apk: 1000, tix: 50, rosterTotal: 7 },
    { id: 'B', apk: 99, tix: 300, rosterTotal: 7 },
    { id: 'C', apk: 500, tix: 500, rosterTotal: 10 }
  ], { mode: 'both', minApk: 100, minTix: 100 });
  assert.deepEqual(transfers.map(t => [t.sideId, t.currency, t.price]), [['A', 'APK', 1000], ['B', 'TIX', 300], ['C', 'APK', 500]]);
  assert.deepEqual(skipped.map(s => [s.sideId, s.currency, s.reason]).sort(), [['A', 'TIX', 'belowMin'], ['B', 'APK', 'belowMin'], ['C', 'TIX', 'rosterFull']]);
});

test('APK transfer: main Scout first (no Callback), then a friend\'s Scout; every side buys its own listing; main claims, fees counted', async () => {
  const { world, svc, settings, profile } = setup({
    M: { funds: 5000, apk: 0, lists: [[player('p1', 40), player('p2', 45), player('big', 900), player('carded', 30)]], friends: ['F'] },
    F: { funds: 1, lists: [[player('f1', 30)]], friends: ['M'] },
    A: { funds: 1, apk: 1000, lists: [[]] }, B: { funds: 1, apk: 800, lists: [[]] }, C: { funds: 1, apk: 50, lists: [[]] }, D: { funds: 1, apk: 600, lists: [[]] }
  }, { roles: { carded: 'card' } });
  await svc.runAndWait({ mainId: 'M', sideIds: ['A', 'B', 'C', 'D'], mode: 'APK', minApk: 100, maxTk: 50, useSpenders: false });
  const r = settings().apkTransferReport;
  assert.equal(r.reason, 'done', JSON.stringify(r.error));
  assert.deepEqual(r.transfers.map(t => [t.sideId, t.price, t.status]), [['A', 1000, 'claimed'], ['B', 800, 'claimed'], ['D', 600, 'claimed']]);
  assert.deepEqual(r.transfers.map(t => t.playerId), ['p1', 'p2', 'f1'], 'Scout first, then the friend\'s board; the Kart player is never used');
  assert.equal(r.transfers[2].source, 'friend:F');
  assert.ok(r.accounts.C.skipped.some(s => s.reason === 'belowMin'));
  const fee = p => Math.ceil(p * 0.05);
  assert.equal(world.users.M.apk, 2400 - fee(1000) - fee(800) - fee(600));
  assert.equal(r.totals.APK.received, world.users.M.apk);
  assert.equal(r.totals.APK.fee, fee(1000) + fee(800) + fee(600));
  assert.deepEqual([world.users.A.apk, world.users.B.apk, world.users.C.apk, world.users.D.apk], [0, 0, 50, 0]);
  assert.equal(r.accounts.M.after.apk, world.users.M.apk, 'balances read again at the end');
  assert.ok(!world.users.M.signed.has('big'));
  // the whole app sees the new balances (account profile)
  assert.equal(profile.M.apk, world.users.M.apk);
  assert.deepEqual(['A', 'B', 'C', 'D'].map(id => profile[id].apk), [0, 0, 50, 0]);
});

test('APK transfer: Scouts are not enough → a spender signs and trades them to main; main never fills up', async () => {
  const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`S${i}`, { funds: 1, apk: 200 + i, lists: [[]] }]));
  const { world, svc, settings } = setup({
    M: { funds: 5000, apk: 0, lists: [[player('p1', 40)]], friends: [], bench: [player('x1', 900), player('x2', 900), player('x3', 900), player('x4', 900), player('x5', 900)] },
    SP: { funds: 3000, lists: [[player('s1', 30), player('s2', 35), player('s3', 20), player('s4', 25), player('s5', 22), player('s6', 21), player('s7', 24)]], friends: [] },
    ...many
  }, { accountRoles: { SP: 'spender' } });
  await svc.runAndWait({ mainId: 'M', sideIds: Object.keys(many), mode: 'APK', minApk: 100, maxTk: 50, useSpenders: true });
  const r = settings().apkTransferReport;
  assert.equal(r.reason, 'done', JSON.stringify(r.error || r.transfers.filter(t => t.status !== 'claimed')));
  assert.equal(r.transfers.length, 8);
  assert.ok(r.transfers.filter(t => String(t.source).startsWith('spender:')).length >= 6, 'the rest came from the spender');
  assert.ok(world.users.M.starters.length + world.users.M.bench.length <= 11);
  assert.ok(Object.keys(many).every(id => world.users[id].apk === 0));
});
