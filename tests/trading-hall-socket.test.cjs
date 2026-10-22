const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TradingHallService, ticketToRow } = require('../src/main/services/trading-hall-service.cjs');

function ticket(i, price, paymentMode = 'APK_TICKET', { base = false } = {}) {
  return {
    id: `t${i}`, playerId: `p${i}`, price, paymentMode, signedSalary: 100 + i,
    user: { teamName: `Seller${i}` },
    player: { id: `p${i}`, name: `Player ${i}`, visualName: `Player ${i}`, rating: 'a-', position: 'sg', newBaseSalary: 90 + i },
    _base: base
  };
}

// Fake market server: replies to market:getMarketPlayers with the given page
// after a random delay, like the real one (event reply, no ack).
function fakeMarket(tickets, { failPages = new Map(), failBase = false } = {}) {
  const requests = [];
  const sockets = [];
  const createSocket = () => {
    const s = new EventEmitter();
    s.closed = false;
    s.close = () => { s.closed = true; };
    s.off = s.removeListener;
    const emit = EventEmitter.prototype.emit.bind(s);
    s.emit = (event, payload) => {
      if (event !== 'market:getMarketPlayers') return emit(event, payload);
      requests.push(payload);
      if (failBase && payload.basePlayersOnly) return true; // never answers
      const key = `${payload.basePlayersOnly}:${payload.page}`;
      const left = failPages.get(key) || 0;
      if (left > 0) { failPages.set(key, left - 1); return true; }
      let list = payload.paymentMode ? tickets.filter(t => t.paymentMode === payload.paymentMode) : tickets;
      if (payload.basePlayersOnly) list = list.filter(t => t._base);
      const start = (payload.page - 1) * 8;
      setTimeout(() => !s.closed && emit('market:marketPlayersData', { tickets: list.slice(start, start + 8), total: list.length }), Math.random() * 10);
      return true;
    };
    setTimeout(() => emit('connect'), 1);
    sockets.push(s);
    return s;
  };
  return { createSocket, requests, sockets };
}

function service(market, opts = {}) {
  const saved = [];
  const logs = [];
  const s = new TradingHallService({
    store: { saveTradingRows: rows => saved.push(rows), getTradeAccount: () => null },
    credentials: {}, activity: { add: entry => logs.push(entry) }, onChanged: () => {},
    createSocket: market.createSocket, concurrency: 4, requestTimeoutMs: 200, ...opts
  });
  return { s, saved, logs };
}

test('ticketToRow maps the market ticket to a Trading Hall row', () => {
  assert.deepEqual(ticketToRow(ticket(1, 25, 'TICKET'), 3), {
    id: 't1', playerId: 'p1', name: 'Player 1', position: 'SG', grade: 'A-', salary: 101,
    base: 91, basePct: 11, isBase: null, value: null, valueChange: null,
    price: 25, currency: 'TIX', seller: 'Seller1', sourcePage: 3
  });
  assert.equal(ticketToRow(ticket(2, 25, 'APK_TICKET'), 1).currency, 'APK');
  assert.equal(ticketToRow({ ...ticket(3, null), price: undefined }, 1), null);
  const below = ticketToRow({ ...ticket(4, 5), signedSalary: 48, player: { newBaseSalary: 50 } }, 1);
  assert.equal(below.basePct, -4);
  assert.equal(ticketToRow({ ...ticket(5, 5), player: {} }, 1).basePct, null);
});

test('scans every page in parallel, keeps price order and marks base listings', async () => {
  const tickets = Array.from({ length: 83 }, (_, i) => ticket(i, 10 + i, 'APK_TICKET', { base: i % 10 === 0 }));
  const market = fakeMarket(tickets);
  const { s, saved, logs } = service(market);
  const rows = await s.start({ stopPrice: 99999, scanCurrency: 'APK_TICKET' });
  assert.equal(rows.length, 83);
  assert.deepEqual(rows.map(r => r.price), tickets.map(t => t.price));
  assert.deepEqual(rows.filter(r => r.isBase).map(r => r.id), tickets.filter(t => t._base).map(t => t.id));
  assert.ok(rows.every(r => typeof r.isBase === 'boolean'));
  assert.equal(s.runtime.status, 'done');
  assert.equal(s.runtime.totalPages, 11);
  assert.match(s.runtime.message, /Completed · 83 listings · 9 base/);
  assert.equal(saved.at(-1).length, 83);
  assert.ok(market.requests.every(r => r.paymentMode === 'APK_TICKET' && r.sort === 'asc'));
  assert.ok(market.requests.some(r => r.basePlayersOnly === true));
  assert.ok(market.sockets.every(sock => sock.closed));
  assert.ok(logs.every(l => l.taskName === 'Trading Hall'));
  assert.match(logs[0].message, /Scan started · APK · stop at price 99,999 · 4 parallel connections/);
  assert.match(logs.at(-1).message, /scan completed in \d+s · 83 listings · 9 base/);
});

test('stops at the price limit without fetching the rest', async () => {
  const tickets = Array.from({ length: 400 }, (_, i) => ticket(i, i));
  const market = fakeMarket(tickets);
  const { s, logs } = service(market);
  const rows = await s.start({ stopPrice: 20 });
  assert.deepEqual(rows.map(r => r.price), Array.from({ length: 20 }, (_, i) => i));
  assert.match(s.runtime.message, /Stopped at price limit/);
  const listingRequests = market.requests.filter(r => !r.basePlayersOnly);
  assert.ok(listingRequests.length < 10, `requested ${listingRequests.length} pages`);
  assert.ok(logs.some(l => /Price limit 20 reached on page 3/.test(l.message)));
});

test('"all" currency sends no paymentMode filter', async () => {
  const market = fakeMarket([ticket(1, 5, 'TICKET'), ticket(2, 6, 'APK_TICKET')]);
  const { s } = service(market);
  const rows = await s.start({ scanCurrency: 'all' });
  assert.deepEqual(rows.map(r => r.currency), ['TIX', 'APK']);
  assert.ok(!('paymentMode' in market.requests[0]));
});

test('a listing that shifts to the next page is kept once', () => {
  const { s } = service(fakeMarket([]));
  const a = ticketToRow(ticket(1, 5), 1);
  const b = ticketToRow(ticket(2, 6), 1);
  const rows = s._collectRows(new Map([[2, [b, { ...a, sourcePage: 2 }]], [1, [a, b]]]), Infinity);
  assert.deepEqual(rows.map(r => r.id), ['t1', 't2']);
});

test('a page that times out is retried on a fresh socket and logged', async () => {
  const tickets = Array.from({ length: 40 }, (_, i) => ticket(i, i));
  const market = fakeMarket(tickets, { failPages: new Map([['false:3', 1]]) });
  const { s, logs } = service(market);
  const rows = await s.start({ stopPrice: 99999 });
  assert.equal(rows.length, 40);
  assert.equal(market.requests.filter(r => r.page === 3 && !r.basePlayersOnly).length, 2);
  assert.ok(logs.some(l => l.level === 'warning' && /page 3 failed .* retrying on a new connection \(2\/3\)/.test(l.message)));
});

test('a failing base pass still completes the scan without base flags', async () => {
  const tickets = Array.from({ length: 20 }, (_, i) => ticket(i, i, 'APK_TICKET', { base: true }));
  const market = fakeMarket(tickets, { failBase: true });
  const { s, logs } = service(market);
  const rows = await s.start({ stopPrice: 99999 });
  assert.equal(rows.length, 20);
  assert.ok(rows.every(r => r.isBase === null));
  assert.equal(s.runtime.status, 'done');
  assert.ok(logs.some(l => l.level === 'warning' && /Base players could not be marked/.test(l.message)));
});

test('stop() aborts the scan and keeps the pages already read', async () => {
  const tickets = Array.from({ length: 800 }, (_, i) => ticket(i, i));
  const market = fakeMarket(tickets);
  const { s, logs } = service(market, { concurrency: 1 });
  const run = s.start({ stopPrice: 99999 }).then(() => null, error => error);
  await new Promise(r => setTimeout(r, 40));
  await s.stop();
  assert.equal((await run)?.name, 'AbortError');
  assert.equal(s.runtime.status, 'stopped');
  assert.ok(s.rows.length > 0 && s.rows.length < 800);
  assert.ok(logs.some(l => /stopped by user · \d+ listings kept/.test(l.message)));
});
