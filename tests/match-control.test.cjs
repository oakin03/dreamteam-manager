const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Controller, assignBench, fit, secondsOf, MODE_OF_TYPE } = require('../src/main/services/match-control.cjs');

// The user's plan (2026-11-13), on a fake match.
function harness() {
  let now = 1000000;
  const emits = [];
  const logs = [];
  const mgr = { now: () => now, isOff: () => false, _log: (level, code, params) => logs.push({ code, params }), _drop() {} };
  const c = new Controller(mgr, { accountId: 'A', name: 'A', userId: 'me', match: { match_id: 'm1', Server: 2, type: 'MP' }, mode: 'tournament' });
  c.gs = c.ws = { socket: { emit: (...a) => emits.push(a) }, close() {} };
  const P = (id, slot, position, stamina) => ({ id, slot, benchSlot: null, position, stamina });
  const aces = [P('a1', 'PG', 'PG', 80), P('a2', 'SG', 'SG', 70), P('a3', 'SF', 'SF/PF', 90), P('a4', 'PF', 'PF', 60), P('a5', 'C', 'C', 75)];
  const bench = [P('b1', null, 'PG', 100), P('b2', null, 'SG', 100), P('b3', null, 'SG/SF', 100), P('b4', null, 'PF', 100), P('b5', null, 'PF/C', 100)].map((p, i) => ({ ...p, benchSlot: i + 1 }));
  const set = patch => { c.state = { ...(c.state || {}), ...patch }; c._learn(c.state); };
  set({ quarter: 1, timeLeft: '10:00', isHalftime: false, timeouts: { me: 3 }, hostTeam: { userId: 'me', score: 20, starters: aces, bench, strategies: { offense: { name: 'Run and Gun' }, defense: { name: '2-3 Zone Defense' } } }, opponentTeam: { userId: 'op', teamName: 'Opp', score: 22, starters: [], bench: [], strategies: { offense: { name: 'Pick and Roll' }, defense: { name: '3-2 Zone Defense' } } } });
  c.strategies = {
    offense: [{ name: 'Run and Gun', learned: true, beats: ['Full-court Press', '3-2 Zone Defense'] }, { name: 'Deep Cut', learned: true, beats: ['3-2 Zone Defense'] }],
    defense: [{ name: '2-3 Zone Defense', learned: true, beats: ['Deep Cut'] }, { name: 'Protect the Lane', learned: true, beats: ['Deep Cut', 'Pick and Roll'] }]
  };
  return { c, emits, logs, set, advance: ms => { now += ms; }, mine: () => c.state.hostTeam };
}
// apply the last updatePlayers to the fake state, like the server would
const applySub = h => { const e = [...h.emits].reverse().find(x => x[0] === 'updatePlayers'); h.set({ hostTeam: { ...h.mine(), starters: e[2], bench: e[3] } }); };

test('rotation: bench to slots by position fit (a SG/SF goes to SF, a PF/C to C)', () => {
  assert.equal(fit('SG/SF', 'SF'), 2);
  assert.equal(fit('PG', 'PG'), 3);
  const pairs = assignBench(['PG', 'SG', 'SF', 'PF', 'C'], [{ id: 'pg', position: 'PG' }, { id: 'sg', position: 'SG' }, { id: 'sgsf', position: 'SG/SF' }, { id: 'pf', position: 'PF' }, { id: 'pfc', position: 'PF/C' }]);
  const by = Object.fromEntries(pairs.map(p => [p.slot, p.id]));
  assert.deepEqual(by, { PG: 'pg', SG: 'sg', SF: 'sgsf', PF: 'pf', C: 'pfc' });
  assert.equal(secondsOf('11:45'), 705);
  assert.equal(MODE_OF_TYPE.MP, 'tournament');
  assert.equal(MODE_OF_TYPE.PK, undefined);
});

test('rotation: Q1 nothing; Q2 the aces go out one by one, most tired first, 6 s apart', async () => {
  const h = harness();
  h.c.strategies = null;   // tactics left out here
  await h.c.tick();
  assert.equal(h.emits.length, 0, 'nothing in Q1');
  h.set({ quarter: 2, timeLeft: '11:50' });
  await h.c.tick();
  assert.equal(h.emits.length, 0, 'not in the first seconds of Q2');
  h.set({ timeLeft: '11:40' });
  await h.c.tick();
  let e = h.emits.at(-1);
  assert.equal(e[0], 'updatePlayers');
  assert.equal(e[2].find(p => p.slot === 'PF').id, 'b4', 'the most tired (PF, 60) first, a PF in');
  assert.equal(e[2].find(p => p.slot === 'PF').position, 'PF', 'the full player is sent, not the stripped update');
  applySub(h);
  await h.c.tick();
  assert.equal(h.emits.length, 1, 'no second substitution within 6 s');
  h.advance(6000);
  await h.c.tick();
  e = h.emits.at(-1);
  assert.equal(e[2].find(p => p.slot === 'SG').id, 'b2', 'then SG (70)');
});

test('rotation: no timeout in the first half; from Q3 one at max court stamina 95; the last one when an ace reaches 95, and the aces come back to their own slots', async () => {
  const h = harness();
  h.c.strategies = null;
  // first half with tired players: no timeout
  h.set({ quarter: 2, timeLeft: '02:00', hostTeam: { ...h.mine(), starters: h.mine().starters.map(p => ({ ...p, stamina: 50 })) } });
  h.c.plan = []; // no bench for this check
  await h.c.tick();
  assert.ok(!h.emits.some(e => e[0] === 'useTimeout'));
  // rotate everyone out (as if Q2 did it)
  const m = h.mine();
  const benchNow = m.starters.map((p, i) => ({ ...p, slot: null, benchSlot: i + 1, stamina: 85 }));
  const court = m.bench.map((p, i) => ({ ...p, slot: ['PG', 'SG', 'SF', 'PF', 'C'][[0, 1, 2, 3, 4][i]], benchSlot: null, stamina: 96 }));
  h.set({ quarter: 3, timeLeft: '10:00', hostTeam: { ...m, starters: court, bench: benchNow } });
  await h.c.tick();
  assert.ok(!h.emits.some(e => e[0] === 'useTimeout'), 'court max 96: wait');
  h.set({ hostTeam: { ...h.mine(), starters: court.map(p => ({ ...p, stamina: 95 })) } });
  await h.c.tick();
  assert.equal(h.emits.filter(e => e[0] === 'useTimeout').length, 1, 'first timeout at 95');
  h.advance(20000); h.set({ timeouts: { me: 2 } });
  await h.c.tick();
  assert.equal(h.emits.filter(e => e[0] === 'useTimeout').length, 2, 'second timeout');
  h.advance(20000); h.set({ timeouts: { me: 1 } });
  await h.c.tick();
  assert.equal(h.emits.filter(e => e[0] === 'useTimeout').length, 2, 'the last waits for an ace at 95');
  h.set({ hostTeam: { ...h.mine(), bench: h.mine().bench.map(p => (p.id === 'a3' ? { ...p, stamina: 95 } : p)) } });
  await h.c.tick();
  assert.equal(h.emits.filter(e => e[0] === 'useTimeout').length, 3);
  const back = h.emits.at(-1);
  assert.equal(back[0], 'updatePlayers');
  assert.deepEqual(Object.fromEntries(back[2].map(p => [p.slot, p.id])), { PG: 'a1', SG: 'a2', SF: 'a3', PF: 'a4', C: 'a5' }, 'every ace in its own slot, in one go');
});

test('rotation: a later stripped update keeps the full fields for updatePlayers', async () => {
  const h = harness();
  h.c.strategies = null;
  const m = h.mine();
  const withRatings = { ...m, starters: m.starters.map(p => ({ ...p, offense: 150, name: 'N' + p.id })), bench: m.bench.map(p => ({ ...p, offense: 120, name: 'N' + p.id })) };
  h.c._onState({ ...h.c.state, hostTeam: withRatings });
  // an update: only id / stamina / slot / benchSlot
  const strip = p => ({ id: p.id, stamina: p.stamina, fouls: 0, slot: p.slot, benchSlot: p.benchSlot });
  h.c._onState({ ...h.c.state, quarter: 2, timeLeft: '11:30', hostTeam: { ...m, starters: m.starters.map(strip), bench: m.bench.map(strip) } });
  await h.c.tick();
  const e = h.emits.find(x => x[0] === 'updatePlayers');
  assert.ok(e[2].every(p => p.offense > 0 && p.name && p.position), 'every starter sent with ratings, name and position');
  assert.ok(e[3].every(p => p.offense > 0), 'the bench too');
});

test('rotation: an update after halftime without isHalftime ends the halftime (Q3 works again)', async () => {
  const h = harness();
  h.c.strategies = null;
  h.c.plan = [];
  const m = h.mine();
  const court = m.starters.map(p => ({ ...p, stamina: 90 }));
  h.c._onState({ ...h.c.state, quarter: 2, timeLeft: '00:00', isHalftime: true, hostTeam: { ...m, starters: court } });
  await h.c.tick();
  assert.equal(h.emits.length, 0, 'nothing at halftime');
  const { isHalftime, ...rest } = h.c.state;
  h.c._onState({ ...rest, quarter: 3, timeLeft: '11:00', hostTeam: { ...m, starters: court } });
  assert.equal(h.c.state.isHalftime, false);
  await h.c.tick();
  assert.ok(h.emits.some(e => e[0] === 'useTimeout'), 'Q3 timeout at court max 90');
});

test('rotation tactics: close game → our defense beats their offense', async () => {
  const h = harness();
  h.c.plan = [];
  await h.c.tick();
  const e = h.emits.find(x => x[0] === 'setActiveStrategyLiveStat');
  assert.ok(e, 'a tactic change');
  assert.equal(e[1].strategyType, 'defense');
  assert.equal(e[1].strategy.name, 'Protect the Lane', 'beats their Pick and Roll');
});
