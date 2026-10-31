const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PlayersService, lastUpdateCutoff, dayKey } = require('../src/main/services/players-service.cjs');

function fakeSocket(world) {
  return () => {
    const s = new EventEmitter();
    s.connected = true; s.off = s.removeListener; s.close = () => {};
    const local = (...a) => EventEmitter.prototype.emit.apply(s, a);
    s.emit = ev => { if (ev === 'getPlayerRankings') setImmediate(() => local('playerRankingsList', world.list)); return true; };
    setImmediate(() => local('connect'));
    return s;
  };
}
const P = (id, value, last, base) => ({ id, name: id, visualName: id, teamAbbr: 'ATL', rating: 'B', ranking: 1, baseSalary: value, lastSalary: last, newBaseSalary: base });

function service(world, at) {
  let data = null;
  const clock = { now: Date.parse(at) };
  const svc = new PlayersService({ store: { getPlayersData: () => data, savePlayersData: v => { data = JSON.parse(JSON.stringify(v)); } }, activity: { add() {} }, createSocket: fakeSocket(world), now: () => clock.now });
  return { svc, clock };
}

test('the value day starts at 11:00 TR', () => {
  assert.equal(dayKey(lastUpdateCutoff(Date.parse('2026-10-30T07:59:00Z'))), '2026-10-29');
  assert.equal(dayKey(lastUpdateCutoff(Date.parse('2026-10-30T08:01:00Z'))), '2026-10-30');
});

test('a rescan keeps the day\'s changes even when the game\'s last value comes back equal', async () => {
  const world = { list: [P('a', 500, 500, 100), P('b', 300, 300, 100)] };
  const { svc, clock } = service(world, '2026-10-29T10:00:00Z');
  await svc.refresh();
  clock.now = Date.parse('2026-10-30T08:06:00Z');
  world.list = [P('a', 450, 500, 100), P('b', 300, 300, 100)];
  let snap = await svc.refresh();
  assert.equal(snap.players.find(p => p.id === 'a').change, -50);
  // later the same day the game reports lastSalary = value: the drop stays
  clock.now = Date.parse('2026-10-30T12:00:00Z');
  world.list = [P('a', 450, 450, 100), P('b', 300, 300, 100)];
  snap = await svc.refresh();
  assert.equal(snap.players.find(p => p.id === 'a').change, -50);
  assert.equal(snap.players.find(p => p.id === 'b').change, 0);
});

test('Base list: the day a player dropped to Base comes from the saved days', async () => {
  const world = { list: [P('a', 500, 500, 100), P('b', 105, 110, 100)] };
  const { svc, clock } = service(world, '2026-10-28T10:00:00Z');
  await svc.refresh();
  clock.now = Date.parse('2026-10-29T10:00:00Z');
  world.list = [P('a', 500, 500, 100), P('b', 104, 105, 100)];
  await svc.refresh();
  clock.now = Date.parse('2026-10-30T10:00:00Z');
  world.list = [P('a', 100, 500, 100), P('b', 103, 104, 100)];
  const snap = await svc.refresh();
  const a = snap.players.find(p => p.id === 'a');
  const b = snap.players.find(p => p.id === 'b');
  assert.equal(a.atBase, true);
  assert.equal(a.baseSince, '2026-10-30', 'dropped today');
  assert.equal(b.atBase, true, 'Base −5%: 103 × 0.95 ≤ 100');
  assert.equal(b.baseSince, '2026-10-28');
  assert.equal(b.baseSinceUnknown, true, 'already at Base on the first saved day');
});

test('at Base rule: 5% under the price is at or below Base, under 75 TK left out', () => {
  const { atBaseRule } = require('../src/main/services/players-service.cjs');
  assert.equal(atBaseRule(200, 190), true, '200 × 0.95 = 190');
  assert.equal(atBaseRule(150, 200), true, 'already below Base');
  assert.equal(atBaseRule(210, 190), false, '199.5 > 190');
  assert.equal(atBaseRule(74, 80), false, 'under 75 TK');
  assert.equal(atBaseRule(75, 75), true);
});
