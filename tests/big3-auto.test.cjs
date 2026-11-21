const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Big3Auto, bestThree, planOf } = require('../src/main/services/big3-auto.cjs');

const NOW = Date.parse('2026-11-09T10:00:00Z');

// Fake game: anonymous reads on sockets, writes through a fake OfficeService connection.
function world(users) {
  const writes = [];
  const read = (event, p) => {
    const u = users[p.userId];
    if (event === 'big3:getUserActiveBig3Type') return { success: true, activeBig3Type: u.type || null };
    if (event === 'big3:getTeams') return { success: true, teams: u.teams || [] };
    if (event === 'superBig3:getUserProgress') return u.super ? { success: true, progress: u.super, playerInfo: u.super.playerIds ? u.super.playerIds.map(id => ({ id, name: id.toUpperCase() })) : (u.super.players || []).map(n => ({ name: n })) } : { success: false, message: 'No Super Big3 team created yet' };
    if (event === 'superBig3:getUserPlayers') return { success: true, players: u.players || [] };
    if (event === 'getTeamOptimized') return { players: { starters: (u.starters || []).map(id => ({ id })), bench: [] } };
    if (event === 'big3:getUserProgress') return { success: true, progress: u.big3 };
    if (event === 'big3:getTrainingAttempts' || event === 'superBig3:getTrainingAttempts') return { success: true, attemptsRemaining: u.attempts };
    return { success: false };
  };
  const createSocket = () => {
    const s = new EventEmitter(); s.off = s.removeListener; s.close = () => {};
    s.timeout = () => ({ emit: (event, p, cb) => setTimeout(() => cb(null, read(event, p)), 1) });
    setTimeout(() => EventEmitter.prototype.emit.call(s, 'connect'), 1);
    return s;
  };
  const office = {
    _open: async account => ({ userId: 'u-' + account.id, own: true }),
    _close() {},
    _ack: async (c, event, payload) => {
      writes.push([c.userId, event, payload.bonusType || payload.playerIds?.join(',') || '']);
      const u = users[c.userId];
      const prog = () => u.type === 'SUPERBIG3' ? u.super : u.big3;
      if (event === 'big3:activate') { u.type = 'BIG3'; return { success: true }; }
      if (event === 'superBig3:activate') { u.type = 'SUPERBIG3'; return { success: true }; }
      if (event === 'superBig3:updatePlayers') { u.super = { id: 'sb-new', level: 0, availablePoints: 0, players: payload.playerIds }; return { success: true }; }
      if (event.endsWith(':finishTraining')) { const p = prog(); p.trainingStart = null; p.trainingEnd = null; p.level += 1; p.availablePoints = (p.availablePoints || 0) + 1; return { success: true, progress: p }; }
      if (event.endsWith(':upgradeBonus')) { const p = prog(); p.availablePoints -= 1; p[payload.bonusType + 'Bonus'] = (p[payload.bonusType + 'Bonus'] || 0) + 1; return { success: true, progress: p }; }
      if (event.endsWith(':startTraining')) { const p = prog(); p.trainingStart = new Date(NOW).toISOString(); p.trainingEnd = new Date(NOW + 3 * 3600e3).toISOString(); u.attempts -= 1; return { success: true, progress: p, attemptsRemaining: u.attempts }; }
      if (event.endsWith(':resetBonuses')) { const p = prog(); p.availablePoints = (p.offenseBonus || 0) + (p.defenseBonus || 0); p.offenseBonus = 0; p.defenseBonus = 0; return { success: true, progress: p }; }
      return { success: false, error: 'unknown ' + event };
    }
  };
  return { createSocket, office, writes };
}

function service(users, settings = {}) {
  const w = world(users);
  const ids = Object.keys(users).map(u => u.slice(2));
  let saved = { ...settings };
  const store = {
    getAccounts: () => ids.map(id => ({ id, name: id })),
    getAccountProfile: () => ({ accounts: Object.fromEntries(ids.map(id => [id, { userId: 'u-' + id }])) }),
    getSettings: () => saved, saveSettings: v => { saved = v; }
  };
  const logs = [];
  const svc = new Big3Auto({ store, activity: { add: e => logs.push(e) }, office: w.office, createSocket: w.createSocket, now: () => NOW });
  return { svc, ...w, logs, settings: () => saved };
}

test('best three: starters by offense + defense; plan: league trio → Big 3, existing Super kept, else a new Super', () => {
  const players = [{ id: 'a', offense: 100, defense: 100 }, { id: 'b', offense: 250, defense: 200 }, { id: 'c', offense: 150, defense: 150 }, { id: 'd', offense: 300, defense: 300 }, { id: 'e', offense: 90, defense: 90 }];
  assert.deepEqual(bestThree(players, new Set(['a', 'b', 'c', 'e'])).map(p => p.id), ['b', 'c', 'a'], 'the bench player d is not used');
  assert.equal(planOf({ trio: { id: 't' }, superBig3: { id: 's' }, best: [] }), 'big3');
  assert.equal(planOf({ trio: null, superBig3: { id: 's' }, best: [] }), 'superKeep');
  assert.equal(planOf({ trio: null, superBig3: null, best: [1, 2, 3] }), 'superCreate');
});

test('scan + activate: trio account → Big 3, Super account kept as it is (not rebuilt), none → Super of the best three', async () => {
  const pl = [{ id: 'p1', offense: 200, defense: 200 }, { id: 'p2', offense: 150, defense: 150 }, { id: 'p3', offense: 120, defense: 120 }, { id: 'p4', offense: 50, defense: 50 }];
  const { svc, writes } = service({
    'u-A': { teams: [{ id: 'bos', team: 'Boston Celtics', ownsTrio: true, level: 4 }], super: { id: 'sbA', level: 2, players: ['X'] } },
    'u-B': { super: { id: 'sbB', level: 1, players: ['Weak', 'Trio', 'Here'] }, players: pl, starters: ['p1', 'p2', 'p3', 'p4'] },
    'u-C': { players: pl, starters: ['p1', 'p2', 'p3', 'p4'] }
  });
  await svc.scanAccounts(['A', 'B', 'C']);
  const rows = svc.snapshot().scan.rows;
  assert.deepEqual([rows.A.plan, rows.B.plan, rows.C.plan], ['big3', 'superKeep', 'superCreate']);
  await svc.setup(['A', 'B', 'C']);
  assert.ok(!writes.some(w => w[0] === 'u-B' && w[1] === 'superBig3:updatePlayers'), 'an existing Super Big 3 is never rebuilt');
  assert.ok(writes.some(w => w[0] === 'u-C' && w[1] === 'superBig3:updatePlayers' && w[2] === 'p1,p2,p3'));
  assert.ok(writes.some(w => w[0] === 'u-A' && w[1] === 'big3:activate'));
  svc.stop();
});

test('training: a finished one is claimed, the bonus goes to offense by default, the next one starts; nothing is started at level 10', async () => {
  const users = {
    'u-A': { type: 'SUPERBIG3', super: { id: 'sbA', level: 3, availablePoints: 0, trainingStart: new Date(NOW - 4 * 3600e3).toISOString(), trainingEnd: new Date(NOW - 3600e3).toISOString(), players: ['P'] }, attempts: 2 },
    'u-B': { type: 'BIG3', teams: [{ id: 'bos', team: 'Boston Celtics', ownsTrio: true, level: 10 }], big3: { level: 10, availablePoints: 1 }, attempts: 3 },
    'u-C': { type: null }
  };
  const { svc, writes } = service(users, { big3Bonus: { B: 'defense' } });
  await svc.tick();
  const a = writes.filter(w => w[0] === 'u-A').map(w => w[1] + (w[2] ? ':' + w[2] : ''));
  assert.deepEqual(a, ['superBig3:finishTraining', 'superBig3:upgradeBonus:offense', 'superBig3:startTraining']);
  const b = writes.filter(w => w[0] === 'u-B').map(w => w[1] + (w[2] ? ':' + w[2] : ''));
  assert.deepEqual(b, ['big3:upgradeBonus:defense'], 'level 10: only the bonus point, no training');
  const s = svc.snapshot().accounts;
  assert.equal(s.A.status, 'training');
  assert.equal(s.B.status, 'max');
  assert.equal(s.C.status, 'inactive');
  assert.ok(!writes.some(w => w[0] === 'u-C'));
  // nothing is due again before the training ends
  writes.length = 0;
  await svc.tick();
  assert.equal(writes.length, 0);
  svc.stop();
});

test('bonus choice: switching to defense resets and moves the points; switched off → no training', async () => {
  const users = { 'u-A': { type: 'BIG3', teams: [{ id: 'bos', team: 'Boston', ownsTrio: true, level: 5 }], big3: { level: 5, availablePoints: 0, offenseBonus: 4, defenseBonus: 0, trainingEnd: new Date(NOW + 3600e3).toISOString() }, attempts: 1 } };
  const { svc, writes, settings } = service(users);
  await svc.setBonus('A', 'defense');
  assert.equal(settings().big3Bonus.A, 'defense');
  assert.deepEqual(writes.map(w => w[1] + (w[2] ? ':' + w[2] : '')), ['big3:resetBonuses', ...Array(4).fill('big3:upgradeBonus:defense')]);
  assert.equal(users['u-A'].big3.defenseBonus, 4);
  await svc.setEnabled(false);
  writes.length = 0;
  users['u-A'].big3.trainingEnd = null;
  await svc.tick();
  assert.equal(writes.length, 0);
  svc.stop();
});

test('broken Super Big 3 (a player left the roster): shown with the missing player, rebuilt with the best three; training logs it once', async () => {
  const pl = [{ id: 'p1', name: 'One', offense: 200, defense: 200 }, { id: 'p2', name: 'Two', offense: 150, defense: 150 }, { id: 'p3', name: 'Three', offense: 120, defense: 120 }];
  const users = {
    'u-A': { type: 'SUPERBIG3', super: { id: 'sbA', level: 4, playerIds: ['p1', 'gone'] }, players: pl, starters: ['p1', 'p2', 'p3'] },
    'u-B': { type: 'SUPERBIG3', super: { id: 'sbB', level: 2, playerIds: ['p1', 'p2', 'p3'] }, players: pl, starters: ['p1', 'p2', 'p3'] }
  };
  const { svc, writes, logs } = service(users);
  await svc.scanAccounts(['A', 'B']);
  const rows = svc.snapshot().scan.rows;
  assert.equal(rows.A.broken, true);
  assert.deepEqual(rows.A.superBig3.missing, ['GONE']);
  assert.equal(rows.A.plan, 'rebuild');
  assert.equal(rows.B.broken, false);
  assert.equal(rows.B.plan, 'superKeep');
  await svc.setup(['A']);
  assert.ok(writes.some(w => w[0] === 'u-A' && w[1] === 'superBig3:updatePlayers' && w[2] === 'p1,p2,p3'));
  assert.ok(!writes.some(w => w[0] === 'u-A' && w[1] === 'superBig3:activate'), 'already the active kind: no activate');
  assert.ok(logs.some(l => l.code === 'b3.rebuilt'));
  svc.stop();
});
