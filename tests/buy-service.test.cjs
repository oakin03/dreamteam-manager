const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { BuyService, rowReady, matchingTickets, pickAccount, affordableCurrencies, PARK_PRICE } = require('../src/main/services/buy-service.cjs');

// Fake market: listings, per-user balances, purchases, my listings; writes need register.
function fakeGame({ users, listings }) {
  const calls = [];
  const st = { users: JSON.parse(JSON.stringify(users)), listings: listings.map(l => ({ status: 'LISTED', ...l })), my: [], seq: 0 };
  // Each roster has `rosterSize` players (default 5): the owned ones plus fillers x1…;
  // the first five are starters. Players can carry equipment and a skill.
  for (const [id, u] of Object.entries(st.users)) {
    u.owned = [...(u.owned || [])];
    for (let i = 1; u.owned.length < (u.rosterSize ?? 5); i++) u.owned.push(`x${i}-${id}`);
    u.gear = u.gear || {};
  }
  const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.close = () => { s.closed = true; s.connected = false; };
    s.registered = null;
    s.timeout = () => ({ emit: (event, p, cb) => {
      calls.push({ event, payload: p });
      if (event === 'updatePlayerPositions') { const u = st.users[s.registered]; u.slots = Object.fromEntries(p.starters.map(x => [x.playerId, x.slot])); (st.lineups ||= []).push(p); }
      setTimeout(() => cb(null, { success: true }), 1);
    } });
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    const reply = (n, d) => setTimeout(() => !s.closed && emitLocal(n, d), 1);
    s.emit = (event, p) => {
      calls.push({ event, payload: p, cookie: Boolean(options.extraHeaders) });
      if (event === 'register') { s.registered = p.userId; return reply('registrationSuccess', {}); }
      if (event === 'getUserBasicInfo') { const u = st.users[p.userId]; return reply('userBasicInfo', { success: true, autoPKTickets: u.apk, ticket: u.tix, funds: 1000 }); }
      if (event === 'market:getMarketPlayers') {
        const mode = p.paymentMode;
        const all = st.listings.filter(l => l.status === 'LISTED' && (!mode || l.paymentMode === mode) && l.player.name.toLowerCase().includes(p.search.toLowerCase())).sort((a, b) => a.price - b.price);
        const page = Number(p.page) || 1;
        return reply('market:marketPlayersData', { tickets: all.slice((page - 1) * 8, page * 8), total: all.length });
      }
      if (!s.registered) return reply(event === 'market:buyPlayer' ? 'market:buyResult' : 'x', { success: false, message: 'Authentication required' });
      const me = s.registered;
      const u = st.users[me];
      if (event === 'equipment:getUserPlayerAndInventory') return reply('equipment:userPlayerAndInventory', { players: u.owned.map((pid, i) => ({ playerId: pid, slot: u.slots?.[pid] ?? (i < 5 ? SLOTS[i] : null), benchSlot: i >= 5 ? i - 4 : null, jerseyInventoryId: u.gear[pid]?.jersey ?? null, skillContainerId: u.gear[pid]?.skill ?? null })) });
      if (event === 'equipment:unequipSelected') { (st.dressLog ||= []).push(['off', p.playerId]); if (u.gear[p.playerId]) u.gear[p.playerId].jersey = null; return reply('equipment:unequipSelectedResult', { success: true }); }
      if (event === 'equipment:equipItem') { (st.dressLog ||= []).push(['on', p.playerId, p.equipmentSlot, p.inventoryId]); (u.gear[p.playerId] ||= {}).jersey = p.inventoryId; return reply('equipment:equipmentUpdated', { success: true }); }
      if (event === 'skills:unassignContainer') { (st.dressLog ||= []).push(['skillOff', p.playerId]); if (u.gear[p.playerId]) u.gear[p.playerId].skill = null; return reply('skills:containerUnassigned', { success: true }); }
      if (event === 'skills:assignContainerToPlayer') { (st.dressLog ||= []).push(['skillOn', p.playerId, p.containerId]); (u.gear[p.playerId] ||= {}).skill = p.containerId; return reply('skills:containerAssigned', { success: true }); }
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
        // Like the game: a listed player leaves the roster (it can be bought again).
        const owner = st.users[me]; if (owner?.owned) owner.owned = owner.owned.filter(id => id !== p.playerId);
        return reply('market:sellResult', { success: true, playerId: p.playerId });
      }
      if (event === 'market:getMyPlayerListings') return reply('market:myPlayerListingsData', { tickets: st.my.filter(t => t.userId === me), total: 1 });
      if (event === 'market:cancelPlayerListing') { const t = st.my.find(x => x.id === p.ticketId); t.status = 'CANCELLED'; (st.users[me].owned ||= []).push(t.playerId); return reply('cancelResult', { success: true, playerId: t.playerId }); }
      return true;
    };
    if (!options.extraHeaders) st.anonOpens = (st.anonOpens || 0) + 1;
    if (!options.extraHeaders && st.failAnonConnects > 0 && st.anonOpens > (st.failAfter || 0)) { st.failAnonConnects--; setTimeout(() => emitLocal('connect_error', new Error('websocket error')), 1); return s; }
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
    sessions: { get: async a => ({ userId: 'u-' + a.id, cookieHeader: 'session=x' }) }, createSocket: game.createSocket, timing: { buyGapMs: 5, idleCloseMs: 500 }, checkCooldown: false
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

test('Auto Buy: already owned and no own listing to make room → the next account; with a listing the workaround buys it', async () => {
  const game = fakeGame({
    users: { 'u-a': { apk: 100, tix: 0, owned: ['p1', 'p2'] }, 'u-b': { apk: 100, tix: 0, owned: ['p2'] } },
    listings: [L('t1', 'p1', 'Jay Huff', 20, 40), L('t2', 'p2', 'Ryan Dunn', 20, 40)]
  });
  const warned = [];
  const { svc, logs, data } = service(game, [['a', 'Trophy3'], ['b', 'Trophy4']]);
  svc.onAttention = (k, t) => warned.push([k, t]);
  svc.addWatch([{ id: 'p1', name: 'Jay Huff' }, { id: 'p2', name: 'Ryan Dunn' }]);
  for (const w of data().watch) svc.updateWatch(w.id, { maxPrice: 20, maxSalary: 50, currency: 'APK' });
  await svc.startAuto({ accountIds: ['a', 'b'], intervalSec: 3 });
  await new Promise(r => setTimeout(r, 3500)); // two scans
  svc.stopAuto();
  await svc.done;
  // Trophy3: 5 players, owns Jay Huff, no listing to take back → passes it on.
  assert.equal(game.st.listings.find(l => l.id === 't1').status, 'SOLD', 'Trophy3 owns Jay Huff → Trophy4 bought him');
  // Trophy4 owns Ryan Dunn, but now has its parked Jay Huff listing: it takes that back
  // to make room, parks its Ryan Dunn, buys, and lists Jay Huff again at the old price.
  assert.equal(game.st.listings.find(l => l.id === 't2').status, 'SOLD');
  assert.equal(game.st.users['u-b'].apk, 60);
  assert.ok(game.st.users['u-b'].owned.includes('p2'), 'the original Ryan Dunn is back in the roster');
  const listed = game.st.my.filter(t => t.status === 'LISTED' && t.userId === 'u-b').map(t => [t.playerId, t.price]).sort();
  assert.deepEqual(listed, [['p1', PARK_PRICE], ['p2', PARK_PRICE]], 'Jay Huff relisted at its old price, the bought Ryan Dunn parked');
  assert.ok(logs.some(l => l.code === 'os.restored'));
  assert.equal(svc.snapshot().auto.status, 'stopped', 'scanning went on until stopped');
}, { timeout: 15000 });

test('Auto Buy keeps running through a short game outage and logs when the connection is back', async () => {
  const game = fakeGame({ users: { 'u-a': { apk: 25, tix: 0 } }, listings: [L('t1', 'p1', 'Jay Huff', 20, 40)] });
  const { svc, logs, data } = service(game, [['a', 'Trophy3']]);
  svc.timing.offlineRetryMs = 50;
  svc.addWatch([{ id: 'p1', name: 'Jay Huff' }]);
  svc.updateWatch(data().watch[0].id, { maxPrice: 20, maxSalary: 50, currency: 'APK' });
  game.st.failAfter = 1; game.st.failAnonConnects = 2; // the balance read works; the scan loop meets two failures
  await svc.startAuto({ accountIds: ['a'], intervalSec: 3 });
  await svc.done;
  assert.ok(logs.some(l => l.code === 'ab.offline'));
  assert.ok(logs.some(l => l.code === 'ab.online'));
  assert.equal(game.st.listings[0].status, 'SOLD', 'bought after the outage');
  assert.equal(svc.snapshot().auto.status, 'noFunds');
}, { timeout: 20000 });

test('price hint: cheapest other listing of the player in that currency, our own listings left out', async () => {
  const game = fakeGame({ users: { 'u-a': { apk: 0, tix: 0 } }, listings: [L('t1', 'p1', 'Jay Huff', 30, 40), L('t2', 'p1', 'Jay Huff', 25, 40, 'APK_TICKET', 'Trophy3'), L('t3', 'p1', 'Jay Huff', 28, 40), L('t4', 'p1', 'Jay Huff', 5, 40, 'TICKET')] });
  const { svc } = service(game, [['a', 'Trophy3']]);
  const r = await svc.cheapest({ playerId: 'p1', name: 'Jay Huff', currency: 'APK' });
  assert.deepEqual(r, { currency: 'APK', cheapest: 28, count: 2, ownCheapest: 25, suggested: 27 });
});

test('a buy and a reprice sign in only for that work: the account is paused first, closed after, then resumed', async () => {
  const game = fakeGame({ users: { 'u-a': { apk: 500, tix: 0 } }, listings: [L('t1', 'p1', 'Jay Huff', 200, 60)] });
  const { svc, data } = service(game, [['a', 'Trophy3']]);
  const steps = [];
  svc.pauseAccount = async (id, task) => {
    steps.push(`pause:${id}:${task}:open=${svc.conns.has(id)}`);
    return async () => { steps.push(`resume:${id}:open=${svc.conns.has(id)}`); };
  };
  const r = await svc.buy('a', { id: 't1', playerId: 'p1', name: 'Jay Huff', price: 200, currency: 'APK', salary: 60 }, { source: 'auto', autoList: true });
  assert.equal(r.ok, true);
  assert.equal(data().bought[0].state, 'listed', 'parked on the market inside the same sign-in');
  await svc.sell(data().bought[0].id, 150, 'APK');
  assert.deepEqual(steps, ['pause:a:Auto Buy:open=false', 'resume:a:open=false', 'pause:a:Auto Buy:open=false', 'resume:a:open=false']);
});

test('quantity: unlimited by default, a number needs to be ≥ 1; Auto Buy stops buying a player at its quantity', async () => {
  const { rowReady, rowDone } = require('../src/main/services/buy-service.cjs');
  const base = { maxPrice: 20, maxSalary: 50, currency: 'APK' };
  assert.ok(rowReady(base), 'no quantity needed while Unlimited (default)');
  assert.ok(!rowReady({ ...base, unlimited: false, qty: '' }));
  assert.ok(!rowReady({ ...base, unlimited: false, qty: 0 }));
  assert.ok(rowReady({ ...base, unlimited: false, qty: 2 }));
  assert.ok(rowDone({ ...base, unlimited: false, qty: 2, boughtCount: 2 }));
  assert.ok(!rowDone({ ...base, boughtCount: 99 }), 'unlimited is never done');

  // One account buys every copy: each bought player is parked on the market before the next buy.
  const game = fakeGame({ users: { 'u-a': { apk: 500, tix: 0 } }, listings: [L('t1', 'p1', 'Jay Huff', 10, 40), L('t2', 'p1', 'Jay Huff', 11, 40), L('t3', 'p1', 'Jay Huff', 12, 40)] });
  const { svc, logs, data } = service(game, [['a', 'Trophy3']]);
  svc.addWatch([{ id: 'p1', name: 'Jay Huff' }]);
  const w = data().watch[0];
  await assert.rejects(svc.startAuto({ accountIds: ['a'], intervalSec: 3 }), /every player: Jay Huff/, 'an incomplete active row blocks the start');
  svc.updateWatch(w.id, { maxSalary: 50, maxPrice: 20, unlimited: false, qty: 2 });
  await svc.startAuto({ accountIds: ['a'], intervalSec: 3 });
  await svc.done;
  assert.equal(data().watch[0].boughtCount, 2);
  assert.equal(game.st.listings.filter(l => l.status === 'LISTED').length, 1, 'the third listing was left alone');
  assert.ok(logs.some(l => l.code === 'ab.rowDone') && logs.some(l => l.code === 'ab.allBought'));
});


test('already owned: equipment, skill and lineup are put back exactly; a stock listing is relisted at 9,999,999 TIX', async () => {
  const { OwnedSwap, pickFiller } = require('../src/main/services/owned-swap.cjs');
  const game = fakeGame({ users: { 'u-a': { apk: 500, tix: 0, owned: ['p9', 'p1'], gear: { p1: { jersey: 'inv-j', skill: 'cont-1' } } } }, listings: [L('t1', 'p1', 'Jay Huff', 20, 40)] });
  // p1 plays SG; a stock listing (expired long ago) is the only one to take back.
  game.st.users['u-a'].slots = { p9: 'PG', p1: 'SG', 'x1-u-a': 'SF', 'x2-u-a': 'PF', 'x3-u-a': 'C' };
  game.st.my.push({ id: 'old', userId: 'u-a', playerId: 'p7', price: 33, paymentMode: 'APK_TICKET', status: 'EXPIRED', createdAt: '2026-01-01T00:00:00Z', player: { id: 'p7', name: 'Old Stock' } });
  game.st.users['u-a'].owned = game.st.users['u-a'].owned.filter(id => id !== 'p7');
  const { svc } = service(game, [['a', 'Trophy3']]);
  const r = await svc.buy('a', { id: 't1', playerId: 'p1', name: 'Jay Huff', price: 20, currency: 'APK', salary: 40 });
  assert.equal(r.ok, true);
  const u = game.st.users['u-a'];
  assert.ok(u.owned.includes('p1'), 'original back');
  assert.equal(u.gear.p1.jersey, 'inv-j', 'jersey on again');
  assert.equal(u.gear.p1.skill, 'cont-1', 'skill on again');
  assert.deepEqual(game.st.dressLog.map(x => x[0]), ['off', 'skillOff', 'on', 'skillOn']);
  assert.equal(u.slots.p1, 'SG', 'back on its old position');
  const relisted = game.st.my.find(t => t.playerId === 'p7' && t.status === 'LISTED');
  assert.equal(relisted.price, PARK_PRICE, 'stock goes back at 9,999,999 TIX');
  assert.equal(relisted.paymentMode, 'TICKET');
  // Filler order: on sale under the cap first, stock over the cap last.
  const now = Date.parse('2026-10-25T10:00:00Z');
  const rows = [
    { ticketId: 's', status: 'EXPIRED', createdAt: '2026-01-01T00:00:00Z', salary: 10 },
    { ticketId: 'o', status: 'LISTED', createdAt: '2026-10-25T09:00:00Z', salary: 900 },
    { ticketId: 'r', status: 'EXPIRED', createdAt: '2026-10-24T10:00:00Z', salary: 50 },
    { ticketId: 'l', status: 'LISTED', createdAt: '2026-10-25T09:00:00Z', salary: 50 }
  ];
  assert.equal(pickFiller(rows, { cap: 1000, used: 500 }, now).ticketId, 'l', 'on sale and under the cap');
  assert.equal(pickFiller(rows.filter(x => x.ticketId !== 'l'), { cap: 1000, used: 500 }, now).ticketId, 'r', 'then was on sale under the cap');
  assert.equal(pickFiller(rows.filter(x => !['l', 'r'].includes(x.ticketId)), { cap: 1000, used: 500 }, now).ticketId, 'o', 'then on sale over the cap');
  assert.equal(pickFiller([], {}, now), null);
});

test('Auto Buy reads every page of the name search: a listing behind similar names on page 2 is found', async () => {
  const others = Array.from({ length: 9 }, (_, i) => L('o' + i, 'p9', 'Jay Huff Jr', 5 + i, 30));
  const game = fakeGame({ users: { 'u-a': { apk: 100, tix: 0 } }, listings: [...others, L('t1', 'p1', 'Jay Huff', 18, 40)] });
  const scans = [];
  const { svc, data } = service(game, [['a', 'Trophy3']]);
  svc.onScan = (ids, currency, tickets, scope) => scans.push({ ids, n: tickets.length, scope });
  svc.addWatch([{ id: 'p1', name: 'Jay Huff' }]);
  svc.updateWatch(data().watch[0].id, { maxPrice: 20, maxSalary: 50, currency: 'APK', unlimited: false, qty: 1 });
  await svc.startAuto({ accountIds: ['a'], intervalSec: 3 });
  await new Promise(r => setTimeout(r, 400));
  svc.stopAuto?.();
  await svc.done?.catch?.(() => {});
  assert.equal(game.st.listings.find(l => l.id === 't1').status, 'SOLD', 'the page-2 listing was bought');
  assert.equal(game.calls.filter(c => c.event === 'market:getMarketPlayers').some(c => c.payload.page === 2), true);
  assert.equal(scans[0].scope.complete, true);
}, { timeout: 10000 });
