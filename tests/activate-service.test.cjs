const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ActivateService, activatable } = require('../src/main/services/activate-service.cjs');

const players = [
  { playerId: 'p1', name: 'One', team: 'BOS', stars: 0, cards: { 1: 2 } },               // only 1★ → not chosen
  { playerId: 'p2', name: 'Two', team: 'LAL', stars: 1, cards: { 3: 1, 2: 1 } },          // → 3★
  { playerId: 'p3', name: 'Three', team: 'DET', stars: 2, cards: { 5: 1 } },              // → 5★
  { playerId: 'p4', name: 'Four', team: 'MIA', stars: 4, cards: { 2: 3 } },               // nothing above
  { playerId: 'p5', name: 'Five', team: 'GSW', stars: 0, cards: { 2: 1 } },               // → 2★
  { playerId: 'p6', name: 'NoTeam', noTeam: true, stars: null, cards: { 3: 1 } },
  { playerId: 'p7', name: 'X Player', team: 'X', x: true, stars: 0, cards: { 5: 1 } } // X players never
];

test('Activatable cards: highest card above the stars, only chosen levels, 5★ first', () => {
  const rows = activatable(players, [5, 4, 3, 2]);
  assert.deepEqual(rows.map(r => [r.playerId, r.target, r.chosen]), [['p3', 5, true], ['p2', 3, true], ['p5', 2, true], ['p1', 1, false]]);
  assert.deepEqual(activatable(players, [5]).filter(r => r.chosen).map(r => r.playerId), ['p3']);
});

function fakeGame({ wrongFor = null } = {}) {
  const sent = [];
  const createSocket = () => {
    const s = new EventEmitter();
    s.connected = true; s.off = s.removeListener; s.close = () => {};
    const local = (...a) => EventEmitter.prototype.emit.apply(s, a);
    s.emit = (event, p) => {
      setImmediate(() => {
        if (event !== 'starcard:activateCard') return;
        sent.push(p);
        const target = { p2: 3, p3: 5, p5: 2 }[p.playerId];
        local('starcard:activateSuccess', { playerName: p.playerId, oldLevel: 0, newLevel: p.playerId === wrongFor ? target - 1 : target });
      });
      return true;
    };
    setImmediate(() => local('connect'));
    return s;
  };
  return { sent, createSocket };
}

function svc(game) {
  const logs = [];
  let settings = { activateLevels: [5, 4, 3, 2] };
  let refreshed = 0;
  const s = new ActivateService({
    store: { getAccounts: () => [{ id: 'm', name: 'Main' }], getAccountProfile: () => ({ mainAccountId: 'm' }), getSettings: () => settings, saveSettings: v => { settings = v; } },
    activity: { add: e => logs.push(e) }, sessions: { get: async () => ({ userId: 'u', cookieHeader: 'c=1' }) },
    cards: { refresh: async () => { refreshed++; }, snapshot: () => ({ players }) },
    createSocket: game.createSocket, timing: { gapMs: 1 }
  });
  return { s, logs, refreshed: () => refreshed, settings: () => settings };
}

test('Activation sends one card per player, highest level first, never the 1★ one', async () => {
  const game = fakeGame();
  const { s, logs, refreshed } = svc(game);
  s.start({ levels: [5, 4, 3, 2] });
  await s.done;
  assert.deepEqual(game.sent.map(p => p.playerId), ['p3', 'p2', 'p5']);
  assert.ok(game.sent.every(p => p.quantity === 1 && p.userId === 'u'));
  assert.equal(logs.filter(l => l.code === 'ac.ok').length, 3);
  assert.deepEqual(logs.find(l => l.code === 'ac.summary').params, { count: 3, skipped: 1, failed: 0 });
  assert.ok(refreshed() >= 2, 'scanned before and after');
});

test('An unexpected star from the game stops the job', async () => {
  const game = fakeGame({ wrongFor: 'p2' });
  const { s, logs } = svc(game);
  s.start({ levels: [5, 4, 3, 2] });
  await s.done;
  assert.deepEqual(game.sent.map(p => p.playerId), ['p3', 'p2']);
  assert.ok(logs.some(l => l.code === 'ac.unexpected'));
  assert.equal(s.snapshot().run.status, 'error');
});
