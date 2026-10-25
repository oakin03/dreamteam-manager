const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MarketService, listingRow } = require('../src/main/services/market-service.cjs');

const USER = 'u1';
function ticket(id, status, { price = 20, mode = 'APK_TICKET', playerId = `p-${id}`, name = `Player ${id}` } = {}) {
  return { id, playerId, price, paymentMode: mode, signedSalary: 48, status, createdAt: '2026-10-01T00:00:00Z',
    player: { id: playerId, name, visualName: name, rating: 'd-', position: 'SG', baseSalary: 50, newBaseSalary: 48 } };
}

// Fake /socket/ game server for one user. `opts` shape the replies.
function fakeGame(tickets, opts = {}) {
  const calls = [];
  const state = { tickets: [...tickets], roster: new Set(opts.roster || []), cooldownOnce: new Set(opts.cooldownOnce || []), dropAuthOnce: new Set(opts.dropAuthOnce || []), kickOnce: new Set(opts.kickOnce || []), registers: 0 };
  const WRITES = new Set(['market:settleTicket', 'market:cancelPlayerListing', 'market:sellPlayer']);
  const createSocket = () => {
    const s = new EventEmitter();
    s.close = () => { s.closed = true; };
    s.off = s.removeListener;
    const emit = EventEmitter.prototype.emit.bind(s);
    const reply = (event, data) => setTimeout(() => !s.closed && emit(event, data), 1);
    s.registered = false;
    s.timeout = () => ({ emit: (event, p, cb) => { calls.push({ event, payload: p }); setTimeout(() => cb(null, { success: true }), 1); } });
    s.emit = (event, payload) => {
      calls.push({ event, payload });
      // Like the game: writes only work on a socket registered as the user.
      if (event === 'register') { s.registered = payload?.userId === USER; state.registers++; return reply('registrationSuccess'); }
      // Another sign-in took the account over: this socket gets no reply any more.
      if (WRITES.has(event) && state.kickOnce.has(event)) { state.kickOnce.delete(event); s.kicked = true; }
      if (s.kicked) return true;
      if (WRITES.has(event) && state.dropAuthOnce.has(event)) { state.dropAuthOnce.delete(event); s.registered = false; }
      if (WRITES.has(event) && !s.registered) return reply(replyName(event), { success: false, type: 'player', message: 'Authentication required' });
      if (state.cooldownOnce.has(event)) { state.cooldownOnce.delete(event); return reply(replyName(event), { success: false, message: 'Please wait 1 seconds before trying again.', retryAfter: 1 }); }
      if (event === 'market:getMyPlayerListings') {
        const start = (payload.page - 1) * 8;
        return reply('market:myPlayerListingsData', { tickets: state.tickets.slice(start, start + 8), total: state.tickets.length });
      }
      if (event === 'market:settleTicket') {
        const t = state.tickets.find(x => x.id === payload.ticketId);
        state.tickets = state.tickets.filter(x => x !== t);
        return reply('market:settleResult', { success: true, type: 'PLAYER', paymentMode: t.paymentMode, payout: Math.floor(t.price * 0.85), fee: t.price - Math.floor(t.price * 0.85) });
      }
      if (event === 'market:cancelPlayerListing') {
        const t = state.tickets.find(x => x.id === payload.ticketId);
        if (state.roster.has(t.playerId)) return reply('cancelResult', { success: false, type: 'player', message: 'You already own this player.' });
        state.tickets = state.tickets.filter(x => x !== t);
        state.roster.add(t.playerId);
        return reply('cancelResult', { success: true, type: 'player', playerId: t.playerId });
      }
      if (event === 'market:sellPlayer') {
        if (opts.sellFails?.includes(payload.playerId)) return reply('market:sellResult', { success: false, message: 'Salary cap exceeded' });
        state.roster.delete(payload.playerId);
        state.tickets.unshift(ticket(`new-${payload.playerId}${state.tickets.some(t => t.id === `new-${payload.playerId}`) ? `-${state.tickets.length}` : ""}`, 'LISTED', { price: payload.price, mode: payload.paymentMode, playerId: payload.playerId }));
        return reply('market:sellResult', { type: 'player', success: true, playerId: payload.playerId, promoted: null });
      }
      if (event === 'getUserBasicInfo') return reply('userBasicInfo', { success: true, autoPKTickets: 120, ticket: 7, funds: 5000, level: 39, salaryCap: 9000, totalSalaryUsed: 1000 });
      // Roster for the already-owned workaround: the roster set padded to opts.rosterSize (5).
      if (event === 'equipment:getUserPlayerAndInventory') {
        const ids = [...state.roster]; for (let i = 1; ids.length < (opts.rosterSize ?? 5); i++) ids.push('r' + i);
        return reply('equipment:userPlayerAndInventory', { players: ids.map((id, i) => ({ playerId: id, slot: i < 5 ? ['PG', 'SG', 'SF', 'PF', 'C'][i] : null, benchSlot: i >= 5 ? i - 4 : null })) });
      }
      return true;
    };
    setTimeout(() => emit('connect'), 1);
    return s;
  };
  return { createSocket, calls, state };
}
const replyName = event => ({ 'market:settleTicket': 'market:settleResult', 'market:cancelPlayerListing': 'cancelResult', 'market:sellPlayer': 'market:sellResult' })[event];

function service(game) {
  const logs = [];
  const merges = [];
  const account = { id: 'a1', name: 'Trophy' };
  const s = new MarketService({
    store: { getAccounts: () => [account] }, activity: { add: e => logs.push(e) },
    accountProfile: { merge: (id, d) => merges.push([id, d]) }, onChanged: () => {},
    sessions: { get: async () => ({ userId: USER, cookieHeader: 'session=x' }) },
    createSocket: game.createSocket, minRetryMs: 0, writeTimeoutMs: 80, checkCooldown: false
  });
  return { s, logs, merges };
}

test('listingRow maps a My Listings ticket', () => {
  assert.deepEqual(listingRow(ticket('t1', 'EXPIRED', { price: 66, mode: 'TICKET' }), 'a1'), {
    ticketId: 't1', playerId: 'p-t1', accountId: 'a1', name: 'Player t1', grade: 'D-', position: 'SG',
    salary: 48, base: 48, basePct: 0, price: 66, currency: 'TIX', status: 'EXPIRED', createdAt: '2026-10-01T00:00:00Z'
  });
});

test('scan reads every page and counts listed / sold / expired', async () => {
  const tickets = [...Array.from({ length: 10 }, (_, i) => ticket(`l${i}`, 'LISTED')), ticket('s1', 'SOLD'), ...Array.from({ length: 6 }, (_, i) => ticket(`e${i}`, 'EXPIRED'))];
  const game = fakeGame(tickets);
  const { s, logs } = service(game);
  const snap = await s.scan(['a1']);
  assert.deepEqual(snap.accounts.a1.counts, { listed: 10, sold: 1, expired: 6, total: 17 });
  assert.deepEqual(game.calls.filter(c => c.event === 'market:getMyPlayerListings').map(c => c.payload.page), [1, 2, 3]);
  assert.ok(game.calls.every(c => !c.payload || c.payload.userId === undefined || c.payload.userId === USER));
  assert.equal(snap.accounts.a1.sold[0].ticketId, 's1');
  assert.equal(snap.busy, false);
  assert.ok(logs.some(l => l.code === 'mk.scanned'));
});

test('claim settles every sold listing, reads the balance from the game and rescans', async () => {
  const game = fakeGame([ticket('s1', 'SOLD', { price: 20 }), ticket('s2', 'SOLD', { price: 100, mode: 'TICKET' }), ticket('l1', 'LISTED')]);
  const { s, logs, merges } = service(game);
  const snap = await s.claim(['a1']);
  assert.deepEqual(game.calls.filter(c => c.event === 'market:settleTicket').map(c => c.payload.ticketId), ['s1', 's2']);
  const last = snap.accounts.a1.lastClaim;
  assert.equal(last.claimed, 2);
  assert.deepEqual(last.payout, { APK: 17, TIX: 85 });
  assert.deepEqual(merges.at(-1), ['a1', { apk: 120, tix: 7, tk: 5000, level: 39 }]);
  assert.equal(snap.accounts.a1.counts.sold, 0);
  assert.ok(logs.some(l => l.code === 'mk.claimDone' && l.params.apk === 17 && l.params.tix === 85));
});

test('a cooldown reply is waited out and the write repeated', async () => {
  const game = fakeGame([ticket('s1', 'SOLD')], { cooldownOnce: ['market:settleTicket'] });
  const { s } = service(game);
  const t0 = Date.now();
  const snap = await s.claim(['a1']);
  assert.equal(game.calls.filter(c => c.event === 'market:settleTicket').length, 2);
  assert.ok(Date.now() - t0 >= 1000, 'waited retryAfter');
  assert.equal(snap.accounts.a1.lastClaim.claimed, 1);
});

test('relist removes and lists only the selected players (expired or listed) with the chosen price and currency', async () => {
  const game = fakeGame([ticket('l1', 'LISTED', { price: 300 }), ticket('e1', 'EXPIRED', { price: 200 }), ticket('e2', 'EXPIRED', { price: 999, mode: 'TICKET' }), ticket('e3', 'EXPIRED'), ticket('s1', 'SOLD')]);
  const { s, logs } = service(game);
  const loaded = await s.loadRelist(['a1']);
  assert.deepEqual(Object.keys(loaded.relist.rows).sort(), ['e1', 'e2', 'e3', 'l1'], 'listed and expired, never sold');
  const snap = await s.relistPlayers([{ ticketId: 'e1', price: 200, currency: 'APK' }, { ticketId: 'e2', price: 450, currency: 'APK' }, { ticketId: 'l1', price: 250, currency: 'TIX' }]);
  const writes = game.calls.filter(c => c.event === 'market:cancelPlayerListing' || c.event === 'market:sellPlayer');
  assert.deepEqual(writes.map(c => [c.event, c.payload.ticketId || c.payload.playerId, c.payload.price, c.payload.paymentMode]), [
    ['market:cancelPlayerListing', 'e1', undefined, undefined],
    ['market:sellPlayer', 'p-e1', 200, 'APK_TICKET'],
    ['market:cancelPlayerListing', 'e2', undefined, undefined],
    ['market:sellPlayer', 'p-e2', 450, 'APK_TICKET'],
    ['market:cancelPlayerListing', 'l1', undefined, undefined],
    ['market:sellPlayer', 'p-l1', 250, 'TICKET']
  ]);
  assert.deepEqual(Object.values(snap.relist.lastRun).map(r => r.state), ['listed', 'listed', 'listed']);
  assert.deepEqual(snap.relist.report, { total: 3, listed: 3, owned: 0, failed: 0, removedNotListed: 0, stopped: 0 });
  // The account was scanned again: the new listings are there with their prices.
  const after = Object.values(snap.relist.rows).filter(r => r.status === 'LISTED').map(r => [r.playerId, r.price, r.currency]).sort();
  assert.deepEqual(after, [['p-e1', 200, 'APK'], ['p-e2', 450, 'APK'], ['p-l1', 250, 'TIX']]);
  assert.equal(snap.relist.rows.e3.state, 'ready');
  assert.ok(logs.some(l => l.code === 'mk.relisted' && l.params.price === 450));
});

test('a player already in the roster is reported, and a failed sale after removal is flagged', async () => {
  const game = fakeGame([ticket('e1', 'EXPIRED', { playerId: 'dup' }), ticket('e2', 'EXPIRED', { playerId: 'cap' })], { roster: ['dup'], sellFails: ['cap'] });
  const { s, logs } = service(game);
  await s.loadRelist(['a1']);
  const snap = await s.relistPlayers([{ ticketId: 'e1', price: 50, currency: 'TIX' }, { ticketId: 'e2', price: 50, currency: 'TIX' }]);
  assert.equal(snap.relist.rows.e1.state, 'owned');
  assert.match(snap.relist.rows.e1.message, /already own/);
  assert.equal(snap.relist.rows.e2.state, 'removedNotListed');
  assert.equal(snap.relist.rows.e2.message, 'Salary cap exceeded');
  assert.equal(snap.relist.report.owned, 1);
  assert.equal(snap.relist.report.removedNotListed, 1);
  assert.ok(logs.some(l => l.level === 'error' && l.code === 'mk.relistSellFailed'));
  assert.equal(game.calls.filter(c => c.event === 'market:sellPlayer').length, 1, 'never sells an owned player twice');
  const rescanned = await s.scan(['a1']);
  assert.equal(rescanned.relist.rows.e2.state, 'removedNotListed', 'still shown after the next scan');
  assert.equal(rescanned.relist.rows.e1.state, 'owned');
});

test('invalid prices and an empty selection are refused before anything is sent', async () => {
  const game = fakeGame([ticket('e1', 'EXPIRED')]);
  const { s } = service(game);
  await s.loadRelist(['a1']);
  await assert.rejects(s.relistPlayers([{ ticketId: 'e1', price: 0, currency: 'APK' }]), /Invalid price/);
  await assert.rejects(s.relistPlayers([{ ticketId: 'e1', price: 10, currency: 'GOLD' }]), /Invalid currency/);
  await assert.rejects(s.relistPlayers([]), /Select at least one player/);
  assert.equal(game.calls.filter(c => c.event === 'market:cancelPlayerListing').length, 0);
});

test('stop during relist finishes the player in progress and leaves the rest untouched', async () => {
  const game = fakeGame([ticket('e1', 'EXPIRED'), ticket('e2', 'EXPIRED'), ticket('e3', 'EXPIRED')], { cooldownOnce: ['market:sellPlayer'] });
  const { s } = service(game);
  await s.loadRelist(['a1']);
  const run = s.relistPlayers(['e1', 'e2', 'e3'].map(ticketId => ({ ticketId, price: 30, currency: 'APK' })));
  // e1 is removed, then its sale waits out a cooldown: stop arrives meanwhile.
  await new Promise(r => setTimeout(r, 200));
  await s.stop();
  const snap = await run;
  assert.equal(snap.relist.rows.e1.state, 'listed', 'the removed player was still listed');
  assert.equal(snap.relist.rows.e2.state, 'stopped');
  assert.equal(snap.relist.rows.e3.state, 'stopped');
  assert.equal(game.calls.filter(c => c.event === 'market:cancelPlayerListing').length, 1);
});

test('only one market operation runs at a time', async () => {
  const game = fakeGame([ticket('s1', 'SOLD')], { cooldownOnce: ['market:settleTicket'] });
  const { s } = service(game);
  const first = s.claim(['a1']);
  await new Promise(r => setTimeout(r, 20));
  await assert.rejects(s.scan(['a1']), /Another Market operation is running/);
  await first;
});

test('the last 19:10 Turkey cutoff is found correctly around the boundary', () => {
  const { lastExpiryCutoff } = require('../src/main/services/market-service.cjs');
  // 19:15 TR (16:15 UTC) -> today's 19:10; 19:05 TR -> yesterday's.
  assert.equal(new Date(lastExpiryCutoff(Date.parse('2026-10-20T16:15:00Z'))).toISOString(), '2026-10-20T16:10:00.000Z');
  assert.equal(new Date(lastExpiryCutoff(Date.parse('2026-10-20T16:05:00Z'))).toISOString(), '2026-10-19T16:10:00.000Z');
  assert.equal(new Date(lastExpiryCutoff(Date.parse('2026-10-20T01:00:00Z'))).toISOString(), '2026-10-19T16:10:00.000Z');
});

test('scheduled relist lists only yesterday\'s expired listings, at the same price and currency', async () => {
  const at = iso => ({ ...ticket('x', 'EXPIRED'), createdAt: iso });
  const game = fakeGame([
    { ...at('2026-10-19T20:00:00Z'), id: 'yday1', playerId: 'p1', price: 200, paymentMode: 'APK_TICKET' },
    { ...at('2026-10-20T10:00:00Z'), id: 'yday2', playerId: 'p2', price: 999, paymentMode: 'TICKET' },
    { ...at('2026-10-18T12:00:00Z'), id: 'old', playerId: 'p3', price: 50, paymentMode: 'APK_TICKET' },
    { ...ticket('l1', 'LISTED'), createdAt: '2026-10-20T17:00:00Z' }
  ]);
  const { s, logs } = service(game);
  const snap = await s.relistRecent(['a1'], { now: Date.parse('2026-10-20T16:15:00Z') });
  const sells = game.calls.filter(c => c.event === 'market:sellPlayer').map(c => [c.payload.playerId, c.payload.price, c.payload.paymentMode]);
  assert.deepEqual(sells, [['p1', 200, 'APK_TICKET'], ['p2', 999, 'TICKET']]);
  assert.equal(snap.relist.rows.old.state, 'ready', 'older expired listing kept as stock');
  assert.equal(snap.relist.report.listed, 2);
  assert.ok(logs.some(l => l.code === 'mk.relistRecentPicked' && l.params.count === 2 && l.params.skipped === 1));
});

test('market writes register the socket first, and register again when the game drops it', async () => {
  const game = fakeGame([ticket('e1', 'EXPIRED')], { dropAuthOnce: ['market:sellPlayer'] });
  const { s } = service(game);
  await s.loadRelist(['a1']);
  const snap = await s.relistPlayers([{ ticketId: 'e1', price: 30, currency: 'APK' }]);
  assert.equal(snap.relist.lastRun.e1.state, 'listed');
  const events = game.calls.map(c => c.event).filter(e => e === 'register' || e.startsWith('market:sell') || e.startsWith('market:cancel'));
  assert.deepEqual(events, ['register', 'register', 'market:cancelPlayerListing', 'market:sellPlayer', 'register', 'market:sellPlayer']);
});

test('listing kind: on sale, was on sale yesterday, or stock', () => {
  const { listingKind } = require('../src/main/services/market-service.cjs');
  const now = Date.parse('2026-10-20T16:15:00Z'); // 19:15 TR, just after today's expiry
  assert.equal(listingKind({ status: 'LISTED', createdAt: '2026-10-01T00:00:00Z' }, now), 'onSale');
  assert.equal(listingKind({ status: 'EXPIRED', createdAt: '2026-10-19T20:00:00Z' }, now), 'recent');
  assert.equal(listingKind({ status: 'EXPIRED', createdAt: '2026-10-19T16:09:00Z' }, now), 'stock');
  assert.equal(listingKind({ status: 'SOLD', createdAt: '2026-10-19T20:00:00Z' }, now), null);
});

test('a socket taken over by another sign-in (no reply) is reconnected and the sale repeated', async () => {
  const game = fakeGame([ticket('e1', 'EXPIRED'), ticket('e2', 'EXPIRED')], { kickOnce: ['market:sellPlayer'] });
  const { s, logs } = service(game);
  await s.loadRelist(['a1']);
  const snap = await s.relistPlayers([{ ticketId: 'e1', price: 30, currency: 'APK' }, { ticketId: 'e2', price: 30, currency: 'APK' }]);
  assert.deepEqual(Object.values(snap.relist.lastRun).map(r => r.state), ['listed', 'listed']);
  assert.ok(logs.some(l => l.code === 'mk.reconnected'));
  assert.ok(!logs.some(l => l.code === 'mk.failed'));
});


test('relist of an already-owned player: another own listing makes room, the roster copy is parked, the listing relisted, all restored', async () => {
  // dup is in the roster and also listed; "other" is another own listing (on sale) to take back.
  const game = fakeGame([ticket('e1', 'EXPIRED', { playerId: 'dup' }), ticket('l9', 'LISTED', { playerId: 'other', price: 77 })], { roster: ['dup'] });
  const { s, logs } = service(game);
  await s.loadRelist(['a1']);
  const snap = await s.relistPlayers([{ ticketId: 'e1', price: 55, currency: 'APK' }]);
  assert.equal(snap.relist.lastRun.e1.state, 'listed');
  const live = game.state.tickets.filter(t => t.status === 'LISTED').map(t => [t.playerId, t.price]).sort();
  assert.deepEqual(live, [['dup', 55], ['other', 77]], 'dup relisted at the new price, the borrowed listing back at its old price');
  assert.ok(game.state.roster.has('dup'), 'the original is back in the roster');
  assert.ok(logs.some(l => l.code === 'os.restored'));
});
