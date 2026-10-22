const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BuyService, rowReady, matchingTickets, pickAccount, affordableCurrencies, PARK_PRICE } = require('../src/main/services/buy-service.cjs');

// Fake market: listings, per-user balances, purchases, my listings; writes need register.
function fakeGame({ users, listings }) {
  const calls = [];
  const st = { users: JSON.parse(JSON.stringify(users)), listings: listings.map(l => ({ status: 'LISTED', ...l })), my: [], seq: 0 };
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.close = () => { s.closed = true; s.connected = false; };
    s.registered = null;
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    const reply = (n, d) => setTimeout(() => !s.closed && emitLocal(n, d), 1);
    s.emit = (event, p) => {
      calls.push({ event, payload: p, cookie: Boolean(options.extraHeaders) });
      if (event === 'register') { s.registered = p.userId; return reply('registrationSuccess', {}); }
      if (event === 'getUserBasicInfo') { const u = st.users[p.userId]; return reply('userBasicInfo', { success: true, autoPKTickets: u.apk, ticket: u.tix, funds: 1000 }); }
      if (event === 'market:getMarketPlayers') {
        const mode = p.paymentMode;
        const tickets = st.listings.filter(l => l.status === 'LISTED' && (!mode || l.paymentMode === mode) && l.player.name.toLowerCase().includes(p.search.toLowerCase())).sort((a, b) => a.price - b.price).slice(0, 8);
        return reply('market:marketPlayersData', { tickets, total: tickets.length });
      }
      if (!s.registered) return reply(event === 'market:buyPlayer' ? 'market:buyResult' : 'x', { success: false, message: 'Authentication required' });
      const me = s.registered;
      if (event === 'market:buyPlayer') {
        const l = st.listings.find(x => x.id === p.ticketId);
        if (!l || l.status !== 'LISTED') return reply('market:buyResult', { success: false, message: 'Listing not found' });
        const u = st.users[me];
        const key = l.paymentMode === 'TICKET' ? 'tix' : 'apk';
        if (u[key] < l.price) return reply('market:buyResult', { success: false, message: 'Insufficient balance' });
        if (u.owned?.includes(l.playerId)) return reply('market:buyResult', { success: false, message: 'You already own this player.' });
        u[key] -= l.price; l.status = 'SOLD'; (u.owned ||= []).push(l.playerId);
        return reply('market:buyResult', { success: true, message: 'Purchase successful' });
      }
      if (event === 'market:sellPlayer') {
        const t = { id: 'my' + (++st.seq), userId: me, playerId: p.playerId, price: p.price, paymentMode: p.paymentMode, status: 'LISTED' };
        st.my.push(t);
        return reply('market:sellResult', { success: true, playerId: p.playerId });
      }
      if (event === 'market:getMyPlayerListings') return reply('market:myPlayerListingsData', { tickets: st.my.filter(t => t.userId === me), total: 1 });
      if (event === 'market:cancelPlayerListing') { const t = st.my.find(x => x.id === p.ticketId); t.status = 'CANCELLED'; return reply('cancelResult', { success: true, playerId: t.playerId }); }
      return true;
    };
    setTimeout(() => { s.connected = true; emitLocal('connect'); }, 1);
    return s;
  };
  return { createSocket, calls, st };
}
const L = (id, playerId, name, price, salary, mode = 'APK_TICKET', seller = 'Stranger') => ({ id, playerId, price, signedSalary: salary, paymentMode: mode, user: { teamName: seller }, player: { id: playerId, name, newBaseSalary: 40 } });

function service(game, accounts) {
  const logs = [];
  let data = null;
  const merged = {};
  const store = {
    getAccounts: () => accounts.map(([id, name]) => ({ id, name })),
    getAccountProfile: () => ({ accounts: Object.fromEntries(accounts.map(([id]) => [id, { userId: 'u-' + id }])) }),
    getBuyData: () => data, saveBuyData: v => { data = JSON.parse(JSON.stringify(v)); }
  };
  const svc = new BuyService({
    store, activity: { add: e => logs.push(e) }, accountProfile: { merge: (id, p) => { merged[id] = p; } }, onChanged() {}, onAttention() {},
    sessions: { get: async a => ({ userId: 'u-' + a.id, cookieHeader: 'session=x' }) }, createSocket: game.createSocket, timing: { buyGapMs: 5, idleCloseMs: 500 }
  });
  return { svc, logs, data: () => data, merged };
}

test('rules: every limit must hold, cheapest first, own listings ignored; account priority and affordability', () => {
  const row = { playerId: 'p1', maxPrice: 20, maxSalary: 50, currency: 'APK' };
  assert.equal(Boolean(rowReady(row)), true);
  assert.equal(Boolean(rowReady({ ...row, maxSalary: '' })), false);
  const t = matchingTickets(row, [L('a', 'p1', 'X', 21, 40), L('b', 'p1', 'X', 20, 40), L('c', 'p1', 'X', 15, 51), L('d', 'p2', 'Y', 5, 1), L('e', 'p1', 'X', 10, 40, 'TICKET'), L('f', 'p1', 'X', 12, 40, 'APK_TICKET', 'Trophy3')], new Set(['Trophy3']));
  assert.deepEqual(t.map(x => x.id), ['b'], '21 > 20, salary 51 > 50, other player, TIX, own listing are all skipped');
  const bal = { a: { apk: 10, tix: 0 }, b: { apk: 30, tix: 5 }, c: { apk: 100, tix: 0 } };
  assert.equal(pickAccount(['a', 'b', 'c'], bal, 'APK', 25), 'b', 'first in priority order that can pay');
  assert.equal(pickAccount(['a', 'b', 'c'], bal, 'TIX', 25), null);
  assert.deepEqual([...affordableCurrencies([row, { ...row, currency: 'TIX', maxPrice: 6 }], ['a', 'b'], bal)], ['APK']);
});

test('Trading Hall buy: registered purchase, bought list, then listing it at a chosen price', async () => {
  const game = fakeGame({ users: { 'u-a': { apk: 500, tix: 0 } }, listings: [L('t1', 'p1', 'Jay Huff', 200, 60)] });
  const { svc, logs, data } = service(game, [['a', 'Trophy3']]);
  const r = await svc.buy('a', { id: 't1', playerId: 'p1', name: 'Jay Huff', price: 200, currency: 'APK', salary: 60 });
  assert.equal(r.ok, true);
  assert.equal(game.st.users['u-a'].apk, 300);
  assert.ok(game.calls.find(c => c.event === 'market:buyPlayer').cookie);
  const entry = data().bought[0];
  assert.equal(entry.state, 'owned');
  await svc.sell(entry.id, 250, 'APK');
  assert.deepEqual(game.st.my.map(t => [t.playerId, t.price, t.paymentMode]), [['p1', 250, 'APK_TICKET']]);
  assert.equal(data().bought[0].state, 'listed');
  // Repricing a listed player: taken off the market first, then listed again.
  await svc.sell(entry.id, 199, 'TIX');
  assert.deepEqual(game.st.my.map(t => [t.price, t.status]), [[250, 'CANCELLED'], [199, 'LISTED']]);
  assert.ok(logs.some(l => l.code === 'by.bought') && logs.some(l => l.code === 'by.listed'));
});

test('Auto Buy: buys only matching listings, follows account priority, parks at 9,999,999 TIX, stops when funds run out', async () => {
  const game = fakeGame({
    users: { 'u-a': { apk: 25, tix: 0 }, 'u-b': { apk: 39, tix: 0 } },
    listings: [L('t1', 'p1', 'Jay Huff', 20, 40), L('t2', 'p1', 'Jay Huff', 21, 40), L('t3', 'p1', 'Jay Huff', 18, 55), L('t4', 'p1', 'Jay Huff', 19, 40)]
  });
  const { svc, logs, data } = service(game, [['a', 'Trophy3'], ['b', 'Trophy4']]);
  svc.addWatch([{ id: 'p1', name: 'Jay Huff' }]);
  const row = data().watch[0];
  svc.updateWatch(row.id, { maxPrice: 20, maxSalary: 50, currency: 'APK' });
  await svc.startAuto({ accountIds: ['a', 'b'], intervalSec: 3 });
  await svc.done;
  // t4 (19) then t1 (20) qualify; t2 is 21 (> 20), t3 salary 55 (> 50).
  assert.deepEqual(game.st.listings.filter(l => l.status === 'SOLD').map(l => l.id).sort(), ['t1', 't4']);
  // a (priority 1) pays 19 → 6 left, so the 20 one goes to b (39 → 19). Nobody can pay
  // the 20 limit any more → Auto Buy stops by itself with the not-enough-APK warning.
  assert.equal(game.st.users['u-a'].apk, 6);
  assert.equal(game.st.users['u-b'].apk, 19);
  assert.equal(svc.snapshot().auto.status, 'noFunds');
  assert.ok(logs.some(l => l.code === 'ab.noFunds' && l.params.currency === 'APK'));
  assert.ok(game.st.my.every(t => t.price === PARK_PRICE && t.paymentMode === 'TICKET'));
  assert.equal(data().bought.length, 2);
  assert.ok(logs.some(l => l.code === 'ab.start'));
}, { timeout: 10000 });
