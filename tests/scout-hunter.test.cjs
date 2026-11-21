const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ScoutHunter } = require('../src/main/services/scout-hunter.cjs');

// Fake game: boards and friend lists read anonymously; a registered socket signs from its own board
// and lists; friend signings and friendships go through a fake friend network.
function setup({ accounts, boards, friends, funds, watch, attempts = {}, items = {}, after = {}, refresh = undefined }) {
  const calls = [];
  const createSocket = () => {
    const s = new EventEmitter(); s.off = s.removeListener; s.close = () => {}; s.disconnect = () => {}; s.connected = true;
    const push = (ev, data) => setTimeout(() => EventEmitter.prototype.emit.call(s, ev, data), 1);
    s.timeout = () => ({ emit: (event, p, cb) => setTimeout(() => {
      calls.push([event, p?.userId, p?.playerId]);
      if (event === 'getFreeAgent') return cb(null, { freeAgents: boards[p.userId] || [], attemptsLeft: attempts[p.userId] ?? 0, cooldownEnds: Date.now() + 30 * 60e3 });
      if (event === 'CallBackFreeAgent') { if (!(attempts[p.userId] > 0)) return cb(null, { success: false, error: 'No attempts left' }); attempts[p.userId]--; return cb(null, { success: true, freeAgents: after[p.userId] || [], attemptsLeft: attempts[p.userId] }); }
      if (event === 'getCallbackItem') return cb(null, { success: true, quantity: items[p.userId] || 0 });
      if (event === 'useCallbackItem') { if (!(items[p.userId] > 0)) return cb(null, { success: false, error: 'No callback items' }); items[p.userId]--; return cb(null, { success: true, freeAgents: after[p.userId] || [], callbackItems: items[p.userId] }); }
      if (event === 'getFriendsBootstrap') return cb(null, { success: true, friends: (friends[p.userId] || []).map(id => ({ id, teamName: id.toUpperCase() })) });
      if (event === 'signFreeAgent') return cb(null, { success: true });
      if (event === 'firePlayer') return cb(null, { success: true });
      if (event === 'getTeamOptimized') return cb(null, { userId: p.userId, players: { starters: [1, 2, 3, 4, 5].map(i => ({ id: 'x' + i })), bench: [{ id: 'x6' }] } });
      cb(null, { success: false });
    }, 1) });
    s.emit = (event, payload) => {
      calls.push([event, payload?.userId, payload?.playerId]);
      if (event === 'register') push('registrationSuccess', { success: true });
      if (event === 'getUserBasicInfo') { const acc = payload.userId.slice(1); push('userBasicInfo', { success: true, id: payload.userId, funds: funds[acc] ?? 0 }); }
      if (event === 'market:sellPlayer') push('market:sellResult', { success: true });
      return true;
    };
    setTimeout(() => EventEmitter.prototype.emit.call(s, 'connect'), 1);
    return s;
  };
  const profile = { mainAccountId: 'M', accounts: Object.fromEntries(accounts.map(a => [a.id, { userId: 'u' + a.id, level: a.level }])) };
  let data = { watch, running: false, warnings: [], ...(refresh ? { refresh } : {}) };
  const store = {
    getAccounts: () => accounts.map(a => ({ id: a.id, name: a.id })),
    getAccountProfile: () => profile,
    getScoutHunter: () => data, saveScoutHunter: v => { data = JSON.parse(JSON.stringify(v)); },
    getPlayersData: () => ({ players: [] })
  };
  const signed = [], befriended = [], listed = [], logs = [];
  const friendNet = {
    fundsAndRoster: async id => ({ funds: funds[id] ?? 0, total: 6, ids: new Set() }),
    signFrom: async (buyer, owner, pid) => { signed.push([buyer, owner, pid]); return { success: true }; },
    _befriend: async (a, b) => { befriended.push([a, b]); },
    closeAll() {}
  };
  const svc = new ScoutHunter({
    store, activity: { add: e => logs.push(e) }, sessions: { get: async a => ({ userId: 'u' + a.id, cookieHeader: 'c' }) }, friendNet, createSocket,
    priceOf: () => ({ price: 999, currency: 'TIX' }), recordListed: e => listed.push(e), tickMs: 1e9
  });
  svc.timer = setInterval(() => {}, 1e9);
  return { svc, calls, signed, befriended, listed, logs, data: () => data };
}
const P = (id, price = 300) => ({ id, name: id.toUpperCase(), baseSalary: price, isSigned: false });
const W = (playerId, lv30 = false) => ({ playerId, name: playerId, lv30, qty: null, bought: 0, enabled: true });

test('scout hunter: own board → the owner signs and lists it; the bought table knows the board', async () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }, { id: 'M', level: 40 }], boards: { uA: [P('p1')] }, friends: {}, funds: { A: 1000 }, watch: [W('p1')] });
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.ok(h.calls.some(c => c[0] === 'signFreeAgent' && c[1] === 'uA'));
  assert.ok(h.calls.some(c => c[0] === 'market:sellPlayer' && c[1] === 'uA'));
  assert.equal(h.listed.length, 1);
  assert.equal(h.listed[0].source, 'scout');
  assert.equal(h.listed[0].from, 'A');
  assert.equal(h.data().watch[0].bought, 1);
});

test('scout hunter: Lv30+ ticked → a Lv30+ friend with the TK signs off the board', async () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }, { id: 'B', level: 35 }, { id: 'M', level: 40 }], boards: { uA: [P('p1')] }, friends: { uB: ['uA'] }, funds: { A: 1000, B: 1000 }, watch: [W('p1', true)] });
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.deepEqual(h.signed, [['B', 'uA', 'p1']]);
  assert.ok(!h.calls.some(c => c[0] === 'signFreeAgent'), 'the Lv15 owner does not sign');
});

test("scout hunter: someone else's board with no Lv30+ friend → not signed, a warning", async () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }, { id: 'M', level: 40 }], boards: { uX: [P('p1')] }, friends: { uA: ['uX'] }, funds: { A: 1000 }, watch: [W('p1', true)] });
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.equal(h.signed.length, 0);
  assert.equal(h.data().warnings[0].reason, 'noLv30');
});

test('scout hunter: own board without TK and no friend → an account with the TK befriends it (never Main) and signs', async () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }, { id: 'C', level: 20 }, { id: 'M', level: 40 }], boards: { uA: [P('p1')] }, friends: {}, funds: { A: 10, C: 1000, M: 5000 }, watch: [W('p1')] });
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.deepEqual(h.befriended, [['C', 'A']]);
  assert.deepEqual(h.signed, [['C', 'uA', 'p1']]);
});

test('scout hunter: refresh options are off by default — no callback is spent', async () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }], boards: { uA: [P('zz')] }, friends: {}, funds: { A: 1000 }, watch: [W('p1')], attempts: { uA: 3 }, items: { uA: 5 }, after: { uA: [P('p1')] } });
  assert.deepEqual(h.svc.snapshot().refresh, { free: false, items: false, freeAccounts: [], itemAccounts: [] });
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.equal(h.calls.filter(c => ['CallBackFreeAgent', 'useCallbackItem'].includes(c[0])).length, 0);
  assert.equal(h.signed.length + h.calls.filter(c => c[0] === 'signFreeAgent').length, 0);
});

test('scout hunter: daily refresh on a chosen account → new board checked at once, the player is signed', async () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }, { id: 'B', level: 15 }], boards: { uA: [P('zz')], uB: [P('zz')] }, friends: {}, funds: { A: 1000, B: 1000 }, watch: [W('p1')], attempts: { uA: 3, uB: 3 }, after: { uA: [P('p1')], uB: [P('p1')] }, refresh: { free: true, items: false, freeAccounts: ['A'], itemAccounts: [] } });
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.equal(h.calls.filter(c => c[0] === 'CallBackFreeAgent').length, 1, 'only the chosen account refreshes');
  assert.deepEqual(h.calls.filter(c => c[0] === 'CallBackFreeAgent').map(c => c[1]), ['uA']);
  assert.ok(h.calls.some(c => c[0] === 'signFreeAgent' && c[1] === 'uA' && c[2] === 'p1'));
});

test('scout hunter: callback items only after the free attempts are gone, and only when allowed', async () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }], boards: { uA: [P('zz')] }, friends: {}, funds: { A: 1000 }, watch: [W('p1')], attempts: { uA: 0 }, items: { uA: 2 }, after: { uA: [P('zz')] }, refresh: { free: true, items: true, freeAccounts: ['A'], itemAccounts: ['A'] } });
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.equal(h.calls.filter(c => c[0] === 'CallBackFreeAgent').length, 0);
  assert.equal(h.calls.filter(c => c[0] === 'useCallbackItem').length, 1);
});

test('scout hunter: a board with a wanted player is not refreshed', async () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }], boards: { uA: [P('p1')] }, friends: {}, funds: { A: 1000 }, watch: [W('p1')], attempts: { uA: 3 }, refresh: { free: true, items: false, freeAccounts: ['A'], itemAccounts: [] } });
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.equal(h.calls.filter(c => c[0] === 'CallBackFreeAgent').length, 0);
});

test('scout hunter: setRefresh keeps only known accounts', () => {
  const h = setup({ accounts: [{ id: 'A', level: 15 }], boards: {}, friends: {}, funds: {}, watch: [W('p1')] });
  clearInterval(h.svc.timer);
  const snap = h.svc.setRefresh({ free: true, freeAccounts: ['A', 'X', 'A'] });
  assert.deepEqual(snap.refresh.freeAccounts, ['A']);
  assert.equal(snap.refresh.free, true);
  assert.equal(snap.refresh.items, false);
});

test("scout hunter: Main's signing goes to a side account (on by default) and the side lists it; off → Main lists", async () => {
  const run = async (option) => {
    const h = setup({ accounts: [{ id: 'M', level: 40 }, { id: 'S', level: 20 }], boards: { uM: [P('p1')] }, friends: {}, funds: { M: 5000, S: 10 }, watch: [W('p1')] });
    if (option === false) h.svc.setOption({ mainToSide: false });
    const handed = [];
    h.svc._toSide = async (mainId, player) => { handed.push([mainId, player.id]); return 'S'; };
    await h.svc.tick();
    clearInterval(h.svc.timer);
    return { h, handed };
  };
  const on = await run(undefined);
  assert.deepEqual(on.handed, [['M', 'p1']]);
  assert.ok(on.h.calls.some(c => c[0] === 'market:sellPlayer' && c[1] === 'uS'), 'the side lists');
  assert.equal(on.h.listed[0].accountId, 'S');
  const off = await run(false);
  assert.deepEqual(off.handed, []);
  assert.ok(off.h.calls.some(c => c[0] === 'market:sellPlayer' && c[1] === 'uM'), 'Main lists');
});

test('scout hunter: the player is in every fitting roster → the already-owned way, a side before Main', async () => {
  const h = setup({ accounts: [{ id: 'M', level: 40 }, { id: 'B', level: 20 }, { id: 'O', level: 20 }], boards: { uX: [P('p1')] }, friends: { uM: ['uX'], uB: ['uX'] }, funds: { M: 9000, B: 1000 }, watch: [W('p1')] });
  // every account already has p1 in its roster
  h.svc._stats = async ids => new Map(ids.map(id => [id, { funds: { M: 9000, B: 1000, O: 0 }[id], total: 8, ids: new Set(['p1']) }]));
  const calls = [];
  h.svc._buyAndList = async (f, buyer, via, ownerAcc, price, opts) => { calls.push({ buyer, via, swap: opts?.swap }); };
  await h.svc.tick();
  clearInterval(h.svc.timer);
  assert.deepEqual(calls, [{ buyer: 'B', via: 'friend', swap: true }]);
});
