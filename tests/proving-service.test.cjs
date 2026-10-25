const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DailyBossService, EliteAscentService } = require('../src/main/services/proving-service.cjs');

// Fake game: bosses + attempts on /simulation-socket/, Elite Ascent on /socket/.
// A started match is "active" for two polls, then ends with the scripted result.
function fakeGame({ level = 41, results = [true, false], floor = 2 } = {}) {
  const state = { left: 2, clears: { b1: 0, b2: 0 }, floor, active: 0, played: [], registered: false, results: [...results] };
  const bosses = () => [
    { id: 'b1', name: 'Street Kings', tier: 'ROOKIE', levelRequired: 10, botUser: { id: 'bot1' }, progress: { totalClears: state.clears.b1 } },
    { id: 'b2', name: 'Court Conquerors', tier: 'PRO', levelRequired: 25, botUser: { id: 'bot2' }, progress: { totalClears: state.clears.b2 } }
  ];
  const finish = apply => { state.active = 2; state.pending = apply; };
  const createSocket = (_u, options) => {
    const s = new EventEmitter();
    s.connected = true; s.off = s.removeListener; s.close = () => { s.connected = false; };
    const local = (...a) => EventEmitter.prototype.emit.apply(s, a);
    const path = options.path || '/socket/';
    s.emit = (event, p) => {
      setImmediate(() => {
        if (event === 'register') { state.registered = true; local('registrationSuccess', { success: true }); }
        if (event === 'backToPeak:getData') local('backToPeak:data', state.registered ? { success: true, data: { floors: [1, 2, 3, 4, 5].map(n => ({ floorNumber: n, enemyUser: { id: 'e' + n, teamName: 'Team ' + n } })), progress: { currentFloor: state.floor, highestFloor: state.floor - 1, isCompleted: false } } } : { success: false, error: 'User not authenticated' });
        if (event === 'backToPeak:getAttempts') local('backToPeak:attempts', { success: true, attemptsUsed: 2 - state.left, attemptsRemaining: state.left });
      });
      return true;
    };
    s.timeout = () => ({ emit: (event, p, cb) => setImmediate(() => {
      if (event === 'dailyBoss:getBosses') return cb(null, { success: true, userLevel: level, bosses: bosses() });
      if (event === 'dailyBoss:getAttempts') return cb(null, { success: true, remaining: state.left, max: 2 });
      if (event === 'getUserActiveMatch') {
        if (state.active > 0) { state.active--; if (state.active === 0) state.pending?.(); return cb(null, { success: true, match: { match_id: 'm' } }); }
        return cb(null, { success: true, match: null });
      }
      if (event === 'playDailyBossMatch' || event === 'playBackToPeakMatch') {
        if (state.left <= 0) return cb(null, { success: false, error: 'No attempts remaining today' });
        state.played.push({ event, p });
        const win = state.results.shift();
        state.left--;
        finish(() => { if (event === 'playDailyBossMatch' && win) state.clears[p.bossId]++; if (event === 'playBackToPeakMatch' && win) state.floor++; });
        return cb(null, { success: true, matchId: 'm', server: 1 });
      }
      cb(null, { success: false });
    }) });
    setImmediate(() => local('connect'));
    return s;
  };
  return { state, createSocket };
}

function deps(game) {
  const logs = [];
  let settings = {};
  const store = {
    getAccounts: () => [{ id: 'a1', name: 'Trophy' }],
    getAccountProfile: () => ({ accounts: { a1: { userId: 'u1' } } }),
    getSettings: () => settings, saveSettings: v => { settings = v; }
  };
  return { logs, settings: () => settings, d: { store, activity: { add: e => logs.push(e) }, sessions: { get: async () => ({ userId: 'u1', cookieHeader: 'c=1' }) }, createSocket: game.createSocket, timing: { pollMs: 1, appearGraceMs: 50 } } };
}

test('Daily Boss plays both attempts against the chosen boss and counts wins from the clears', async () => {
  const game = fakeGame({ results: [true, false] });
  const { d, logs, settings } = deps(game);
  const svc = new DailyBossService(d);
  await svc.runAndWait({ a1: 'b2' });
  assert.equal(game.state.played.length, 2);
  assert.deepEqual(game.state.played[0].p, { userId: 'u1', bossId: 'b2', opponentId: 'bot2' });
  assert.deepEqual(logs.filter(l => /matchWon|matchLost/.test(l.code)).map(l => l.code), ['bo.matchWon', 'bo.matchLost']);
  const row = settings().dailyBossReport.rows[0];
  assert.deepEqual({ status: row.status, played: row.played, won: row.won, lost: row.lost }, { status: 'done', played: 2, won: 1, lost: 1 });
});

test('Daily Boss skips an account below the boss level', async () => {
  const game = fakeGame({ level: 20 });
  const { d, logs } = deps(game);
  await new DailyBossService(d).runAndWait({ a1: 'b2' });
  assert.equal(game.state.played.length, 0);
  assert.ok(logs.some(l => l.code === 'bo.locked'));
});

test('Elite Ascent signs in, plays the current floor and climbs on a win', async () => {
  const game = fakeGame({ results: [true, true], floor: 2 });
  const { d, logs, settings } = deps(game);
  const svc = new EliteAscentService(d);
  await svc.runAndWait({ a1: true });
  assert.ok(game.state.registered, 'floors need a registered socket');
  assert.deepEqual(game.state.played.map(m => m.p.floorNumber), [2, 3]);
  assert.deepEqual(game.state.played.map(m => m.p.opponentId), ['e2', 'e3']);
  assert.equal(game.state.floor, 4);
  assert.equal(settings().eliteAscentReport.rows[0].won, 2);
  assert.ok(logs.some(l => l.code === 'ea.matchWon' && l.params.next === 4));
});
