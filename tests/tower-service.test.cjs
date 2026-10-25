const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TowerService, nextTower } = require('../src/main/services/tower-service.cjs');

const MODES = [{ id: 'm-ch', name: 'challenger', displayName: 'Challenger Mode', sortOrder: 1 }, { id: 'm-th', name: 'threat', displayName: 'Threat Mode', sortOrder: 2 }, { id: 'm-ri', name: 'rival', displayName: 'Rival Mode', sortOrder: 3 }];
const FLOORS = Object.fromEntries(MODES.map(m => [m.id, Array.from({ length: 60 }, (_, i) => ({ floorNumber: i + 1, enemyUserId: `${m.name}-${i + 1}` }))]));

// Fake game. `outcome(user, mode, floor, n)` decides a match (true = win); `salaryCap` refuses starts.
function fakeGame({ users, outcome, needsRegister = false }) {
  const calls = [];
  const st = Object.fromEntries(Object.entries(users).map(([u, v]) => [u, { floors: { 'm-ch': 1, 'm-th': 1, 'm-ri': 1, ...(v.floors || {}) }, match: null, left: 0, other: v.otherMatch || 0, salaryCap: Boolean(v.salaryCap), played: [] }]));
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.close = () => { s.closed = true; };
    const cookieUser = 'u-' + String(options.extraHeaders?.Cookie || '').replace('session=', '');
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    s.emit = (event, p) => {
      calls.push({ event, path: options.path });
      if (event === 'register') { s.registered = true; setTimeout(() => emitLocal('registrationSuccess', {}), 1); return true; }
      if (event === 'towerChallenge:getTowerData') {
        if (needsRegister && !s.registered) return true; // silent like the game
        const u = st[cookieUser];
        const userProgress = Object.fromEntries(MODES.map(m => [m.id, { currentFloor: u.floors[m.id], isCompleted: u.floors[m.id] > 60 }]));
        setTimeout(() => emitLocal('towerChallenge:towerData', { success: true, data: { modes: MODES, floorsByMode: FLOORS, userProgress } }), 1);
      }
      return true;
    };
    s.timeout = () => ({ emit: (event, p, cb) => {
      calls.push({ event, path: options.path, payload: p });
      const u = st[p.userId];
      let reply = { success: false };
      if (event === 'getUserActiveMatch') {
        if (u.other > 0) { u.other--; reply = { success: true, match: { type: 'PK' } }; }
        else {
          if (u.match && --u.left < 0) { // the match ends: apply the result
            const won = outcome(p.userId, u.match.mode, u.match.floor, u.played.length);
            u.played.push([u.match.mode, u.match.floor, won]);
            if (won) u.floors[u.match.modeId] += 1;
            u.match = null;
          }
          reply = { success: true, match: u.match };
        }
      }
      if (event === 'playTowerChallengeMatch') {
        if (u.salaryCap) reply = { success: false, message: 'Your team is over the salary cap.' };
        else { u.match = { mode: p.mode, modeId: p.modeId, floor: p.floorNumber }; u.left = 1; reply = { success: true, matchId: 'tower-' + p.mode }; }
      }
      setTimeout(() => cb(null, reply), 1);
    } });
    if (st.__failConnects > 0) { st.__failConnects--; setTimeout(() => emitLocal('connect_error', new Error('websocket error')), 1); return s; }
    setTimeout(() => emitLocal('connect'), 1);
    return s;
  };
  return { createSocket, calls, st };
}

function service(game, accounts) {
  const logs = [];
  let report = null;
  const store = { getAccounts: () => accounts.map(([id, name]) => ({ id, name })), getTowerReport: () => report, saveTowerReport: r => { report = r; } };
  const svc = new TowerService({ store, activity: { add: e => logs.push(e) }, onChanged() {}, sessions: { get: async a => ({ userId: 'u-' + a.id, cookieHeader: 'session=' + a.id }) }, createSocket: game.createSocket, timing: { pollMs: 1, appearGraceMs: 50, startGapMs: 0 } });
  return { svc, logs, report: () => report };
}

test('nextTower: lowest floor first, game order on ties, only active towers', () => {
  const t = (label, floor, order, state = 'active') => ({ label, floor, order, state });
  assert.equal(nextTower([t('C', 2, 0), t('T', 1, 1), t('R', 1, 2)]).label, 'T');
  assert.equal(nextTower([t('C', 1, 0, 'stopped'), t('T', 3, 1), t('R', 2, 2)]).label, 'R');
  assert.equal(nextTower([t('C', 5, 0, 'done')]), null);
});

test('plays floor 1 of every tower before floor 2; 3 losses in a row give a tower up; all given up stops the account', async () => {
  // Wins on challenger and threat floor 1; rival always loses; floor 2 always loses.
  const game = fakeGame({ users: { 'u-a': {} }, outcome: (u, mode, floor) => floor === 1 && mode !== 'rival' });
  const { svc, logs, report } = service(game, [['a', 'Trophy3']]);
  await svc.runAndWait(['a']);
  const played = game.st['u-a'].played.map(([m, f]) => `${m}${f}`);
  assert.deepEqual(played.slice(0, 3), ['challenger1', 'threat1', 'rival1'], 'floor 1 of each tower first');
  const row = report().rows[0];
  const by = Object.fromEntries(row.towers.map(t => [t.mode, t]));
  assert.deepEqual([by.challenger.floor, by.challenger.wins, by.challenger.losses, by.challenger.reason], [2, 1, 3, 'losses']);
  assert.deepEqual([by.rival.floor, by.rival.wins, by.rival.losses, by.rival.reason], [1, 0, 3, 'losses']);
  assert.equal(row.wins, 2);
  assert.equal(row.status, 'finished');
  assert.ok(logs.filter(l => l.code === 'tw.towerStopped').length === 3);
  assert.ok(logs.some(l => l.code === 'tw.summary'));
});

test('waits for a running match first; tower data falls back to a registered connection', async () => {
  const game = fakeGame({ users: { 'u-a': { otherMatch: 3, floors: { 'm-ch': 61, 'm-th': 61 } } }, outcome: () => true, needsRegister: true });
  const { svc, logs, report } = service(game, [['a', 'Trophy3']]);
  svc.timing.cookieTryMs = 20;
  await svc.runAndWait(['a']);
  assert.ok(logs.some(l => l.code === 'tw.waitMatch'));
  assert.ok(game.calls.some(c => c.event === 'register'));
  const rival = report().rows[0].towers.find(t => t.mode === 'rival');
  assert.ok(rival.wins >= 1);
}, { timeout: 60000 });

test('salary cap stops that account with the Auto Play style alert; the other account keeps playing', async () => {
  const game = fakeGame({ users: { 'u-a': { salaryCap: true }, 'u-b': { floors: { 'm-ch': 60, 'm-th': 61, 'm-ri': 61 } } }, outcome: () => true });
  const { svc, logs, report } = service(game, [['a', 'Trophy3'], ['b', 'Trophy4']]);
  await svc.runAndWait(['a', 'b']);
  const rows = Object.fromEntries(report().rows.map(r => [r.name, r]));
  assert.equal(rows.Trophy3.status, 'salaryCap');
  assert.ok(logs.some(l => l.code === 'tw.salaryCap' && l.alertType === 'salary-cap' && l.taskName === 'Tower'));
  assert.equal(rows.Trophy4.status, 'done');
});

test('stop selected stops only that account', async () => {
  const game = fakeGame({ users: { 'u-a': {}, 'u-b': { floors: { 'm-ch': 60, 'm-th': 61, 'm-ri': 61 } } }, outcome: () => false });
  const { svc, report } = service(game, [['a', 'Trophy3'], ['b', 'Trophy4']]);
  game.st['u-a'].left = 0;
  const p = svc.runAndWait(['a', 'b']);
  setTimeout(() => svc.stop(['a']), 5);
  await p;
  const rows = Object.fromEntries(report().rows.map(r => [r.name, r]));
  assert.equal(rows.Trophy3.status, 'stopped');
  assert.notEqual(rows.Trophy4.status, 'stopped');
});

test('a game outage: the account waits for the shared check, then plays on from the game floors', async () => {
  const { GameHealth } = require('../src/main/services/game-health.cjs');
  const game = fakeGame({ users: { 'u-a': { floors: { 'm-ch': 60, 'm-th': 61, 'm-ri': 61 } } }, outcome: () => true });
  game.st.__failConnects = 1;
  const logs = [];
  let report = null;
  const health = new GameHealth({ activity: { add: e => logs.push(e) }, createSocket: game.createSocket, probeMs: 20 });
  const svc = new TowerService({
    store: { getAccounts: () => [{ id: 'a', name: 'Trophy3' }], getTowerReport: () => report, saveTowerReport: r => { report = r; } },
    activity: { add: e => logs.push(e) }, onChanged() {}, sessions: { get: async a => ({ userId: 'u-' + a.id, cookieHeader: 'session=' + a.id }) },
    createSocket: game.createSocket, gameHealth: health, timing: { pollMs: 1, appearGraceMs: 50, cookieTryMs: 20, startGapMs: 0 }
  });
  await svc.runAndWait(['a']);
  assert.ok(logs.some(l => l.code === 'gh.down') && logs.some(l => l.code === 'gh.up'));
  assert.equal(report.rows[0].status, 'done', 'finished the last floor after the outage');
  health.shutdown();
});
