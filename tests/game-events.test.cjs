const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { GameSocket } = require('../src/main/services/game-socket.cjs');
const { GameEvents } = require('../src/main/services/game-events.cjs');
const { PvpService } = require('../src/main/services/pvp-service.cjs');

// A fake game where every /socket/ registration of a user kicks that user's older one.
function fakeGame({ cooldown = null } = {}) {
  const sockets = [];
  const registered = new Map(); // userId -> socket
  const calls = [];
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.connected = true;
    s.path = options.path;
    s.off = s.removeListener;
    s.close = () => { s.connected = false; };
    s.connect = () => { s.connected = true; setImmediate(() => local('connect')); };
    const local = (...a) => EventEmitter.prototype.emit.apply(s, a);
    s.local = local;
    s.emit = (event, payload) => {
      calls.push({ socket: s, event, payload });
      setImmediate(() => {
        if (event === 'register') {
          const old = registered.get(payload.userId);
          if (old && old !== s) old.local('duplicateLogin', { message: 'You were logged out due to another login.' });
          registered.set(payload.userId, s);
          local('registrationSuccess', { success: true });
        } else if (event === 'market:checkCooldown') {
          local('market:cooldownStatus', cooldown || { onCooldown: false, remainingTime: 0 });
        } else if (event === 'ping') {
          // a kicked socket gets no answers, like the game
          if (registered.get(payload.userId) === s) local('pong', { ok: true });
        } else if (event === 'getPvpArenaStatus') {
          local('pvpArenaStatus', { success: true, isActive: Boolean(fakeGame.arenaOpen), nextSession: 'evening' });
        }
      });
      return true;
    };
    sockets.push(s);
    setImmediate(() => local('connect'));
    return s;
  };
  return { createSocket, sockets, calls };
}

test('A kicked connection is reported with the service that took the account and signs in again on its next request', async () => {
  GameSocket._resetKicks();
  const kicks = [];
  GameSocket.onKick(k => kicks.push(k));
  const game = fakeGame();
  const market = await GameSocket.open({ createSocket: game.createSocket });
  await market.register('u1', { owner: 'Market' });
  const buy = await GameSocket.open({ createSocket: game.createSocket });
  await buy.register('u1', { owner: 'Auto Buy' });
  await new Promise(r => setImmediate(r));
  assert.equal(kicks.length, 1);
  assert.deepEqual({ owner: kicks[0].owner, by: kicks[0].by, count: kicks[0].count }, { owner: 'Market', by: 'Auto Buy', count: 1 });
  assert.ok(market.kicked);
  const r = await market.call('ping', { userId: 'u1' }, 'pong', { timeoutMs: 500 });
  assert.deepEqual(r, { ok: true }, 'signed in again before the request, so it is answered');
  assert.equal(market.kicked, null);
  GameSocket.onKick(null);
});

test('Two services kicking each other slow down and then stop: no endless loop', async () => {
  GameSocket._resetKicks();
  const kicks = [];
  GameSocket.onKick(k => kicks.push(k));
  const game = fakeGame();
  const a = await GameSocket.open({ createSocket: game.createSocket });
  const b = await GameSocket.open({ createSocket: game.createSocket });
  await a.register('u1', { owner: 'Market' });
  // Make the slow-down waits instant for the test.
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 15000 ? 0 : ms, ...rest);
  let stopped = null;
  try {
    for (let i = 0; i < 12 && !stopped; i++) {
      await b.register('u1', { owner: 'Auto Buy' });   // kicks a
      await new Promise(r => setImmediate(r));
      try { await a.call('ping', { userId: 'u1' }, 'pong', { timeoutMs: 300 }); } catch (error) { stopped = error; }
    }
  } finally { global.setTimeout = realSetTimeout; }
  assert.ok(stopped, 'the kicked service gives up');
  assert.equal(stopped.code, 'KICK_LOOP');
  assert.ok(kicks.some(k => k.slowed && k.waitMs >= 15000), 'waits longer before giving up');
  assert.ok(kicks.some(k => k.gaveUp));
  assert.ok(kicks.filter(k => k.owner === 'Market' && !k.slowed && !k.gaveUp).length <= 6, 'Market is kicked at most a handful of times');
  GameSocket.onKick(null);
});

test('Market cooldown is read in seconds (0 when free, null when the game is silent)', async () => {
  let game = fakeGame({ cooldown: { onCooldown: true, remainingTime: 7 } });
  let gs = await GameSocket.open({ createSocket: game.createSocket });
  assert.equal(await gs.marketCooldown(), 7);
  game = fakeGame();
  gs = await GameSocket.open({ createSocket: game.createSocket });
  assert.equal(await gs.marketCooldown(), 0);
  const silent = (_u, o) => { const s = new EventEmitter(); s.off = s.removeListener; s.close = () => {}; const local = EventEmitter.prototype.emit.bind(s); s.emit = () => true; setImmediate(() => local('connect')); return s; };
  gs = await GameSocket.open({ createSocket: silent });
  assert.equal(await gs.marketCooldown({ timeoutMs: 50 }), null);
});

test('Game kicks and the salary update reach Activity, and the salary update refreshes once', async () => {
  GameSocket._resetKicks();
  const logs = [];
  let refreshed = 0;
  const game = fakeGame();
  const store = { getAccounts: () => [{ id: 'a1', name: 'Trophy' }], getAccountProfile: () => ({ accounts: { a1: { userId: 'u1' } } }) };
  const ev = new GameEvents({ store, activity: { add: e => logs.push(e) }, createSocket: game.createSocket, onSalaryUpdate: () => { refreshed++; } });
  ev.start();
  await new Promise(r => setTimeout(r, 20));
  const chat = game.sockets.find(s => s.path === '/chat-socket/');
  chat.local('salaryUpdateComplete', {});
  chat.local('salaryUpdateComplete', {});
  await new Promise(r => setImmediate(r));
  assert.equal(refreshed, 1);
  assert.equal(logs.filter(l => l.code === 'ge.salaryUpdated').length, 1);

  const tower = await GameSocket.open({ createSocket: game.createSocket });
  await tower.register('u1', { owner: 'Tower' });
  // The game page (not one of ours) signs the account in.
  const browser = game.createSocket('x', { path: '/socket/' });
  browser.emit('register', { userId: 'u1' });
  await new Promise(r => setTimeout(r, 10));
  const kick = logs.find(l => l.code === 'gs.kickedByGame');
  assert.equal(kick.accountName, 'Trophy');
  assert.equal(kick.params.service, 'Tower');
  ev.stop();
  GameSocket.onKick(null);
});

test('Daily PVP waits for a closed arena before stopping anything and goes on when the game says it opened', async () => {
  fakeGame.arenaOpen = false;
  const game = fakeGame();
  const logs = [];
  const pvp = new PvpService({ store: { getAccounts: () => [], getAccountProfile: () => ({ accounts: {} }) }, activity: { add: e => logs.push(e) }, sessions: {}, onChanged() {}, createSocket: game.createSocket, timing: { arenaPollMs: 1000 } });
  let done = false;
  const wait = pvp.waitForArena(new AbortController().signal).then(() => { done = true; });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(done, false);
  assert.equal(pvp.snapshot().waitingArena, true);
  const anon = game.sockets.find(s => s.path === '/socket/' || !s.path);
  anon.local('pvpArenaStatusChanged', { isActive: true, nextSession: null });
  await wait;
  assert.equal(pvp.snapshot().waitingArena, false);
  assert.deepEqual(logs.map(l => l.code), ['pvp.waitArena', 'pvp.arenaOpened']);

  fakeGame.arenaOpen = true;
  logs.length = 0;
  await pvp.waitForArena(new AbortController().signal);
  assert.deepEqual(logs, [], 'an open arena starts at once');
  pvp.anon?.close();
});
