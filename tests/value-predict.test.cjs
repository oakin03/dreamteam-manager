const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ValuePredictService, fitModel, rankTables, normName, capFor } = require('../src/main/services/value-predict-service.cjs');

// A game whose offense / defense follow a known formula of the averages.
const OFF = a => Math.round(10 + 4 * a.pts + 9 * a.ast - 5 * a.to);
const DEF = a => Math.round(2 + 8.5 * a.reb + 32 * a.stl + 28 * a.blk);
const VALUES = [2500, 2470, 2440, 2410, 2380, 2350];
function gamePlayers() {
  const base = [
    ['p1', 'Nikola Jokić', 'DEN', { pts: 29, reb: 13, ast: 12, stl: 1.8, blk: 0.7, to: 4.4, pf: 2.3 }],
    ['p2', 'Luka Doncic', 'LAL', { pts: 33, reb: 8, ast: 10, stl: 2.8, blk: 0.2, to: 4, pf: 2.5 }],
    ['p3', 'V.J. Edgecombe', 'PHI', { pts: 15, reb: 5, ast: 4, stl: 1.5, blk: 0.5, to: 2, pf: 2 }],
    ['p4', 'Jimmy Butler III', 'GSW', { pts: 20, reb: 5, ast: 5, stl: 1.4, blk: 0.3, to: 1.5, pf: 1.5 }],
    ['p5', 'Role Player', 'DEN', { pts: 6, reb: 3, ast: 1, stl: 0.5, blk: 0.2, to: 0.6, pf: 1.8 }],
    ['p6', 'Hand Set Rookie', 'WAS', { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 }, 120, 100]
  ];
  // plus filler players so the formula can be fitted
  for (let i = 0; i < 60; i++) base.push([`f${i}`, `Filler ${i}`, 'MIA', { pts: 4 + (i % 17), reb: 2 + (i % 9), ast: 1 + (i % 6), stl: 0.3 + (i % 5) / 4, blk: 0.1 + (i % 4) / 5, to: 0.5 + (i % 3) / 2, pf: 1 + (i % 4) / 3 }]);
  const list = base.map(([id, name, team, a, off, def]) => ({ id, name, visualName: name, teamAbbr: team, averagePoints: a.pts, averageRebounds: a.reb, averageAssists: a.ast, averageSteals: a.stl, averageBlocks: a.blk, averageTurnovers: a.to, averageFoul: a.pf, offense: off ?? OFF(a), defense: def ?? DEF(a) }));
  list.sort((a, b) => (b.offense + b.defense) - (a.offense + a.defense));
  return list.map((p, i) => ({ ...p, ranking: i + 1, baseSalary: VALUES[i] ?? Math.max(50, 2350 - (i - 5) * 20), rating: i < 3 ? 'S+' : 'S' }));
}

function fakeSocket(world) {
  return () => {
    const s = new EventEmitter();
    s.connected = true; s.off = s.removeListener; s.close = () => {};
    const local = (...a) => EventEmitter.prototype.emit.apply(s, a);
    s.emit = ev => { if (ev === 'getPlayerRankings') setImmediate(() => local('playerRankingsList', world.players)); return true; };
    setImmediate(() => local('connect'));
    return s;
  };
}
// ESPN: one game on 2026-10-20 where Edgecombe (as "VJ Edgecombe") and Butler ("Jimmy Butler") play.
// `games` games on 2026-10-20, -21, …; `lines` per team, or per team per game (function of the game index).
function fakeEspn(lines, games = 1) {
  return async url => {
    const day = Number(url.match(/dates=2026102(\d)/)?.[1] ?? -1);
    if (url.includes('scoreboard')) return { events: day >= 0 && day < games ? [{ id: 'e' + day, date: `2026-10-2${day}T23:00Z`, season: { type: 2 }, competitions: [{ status: { type: { completed: true } } }] }] : [] };
    if (url.includes('summary?event=e')) {
      const names = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
      const side = (abbr, rows) => ({ team: { abbreviation: abbr }, statistics: [{ names, athletes: rows.map(([name, s]) => ({ athlete: { displayName: name }, stats: [String(s.min), String(s.pts), '0-0', '0-0', '0-0', String(s.reb), String(s.ast), String(s.to), String(s.stl), String(s.blk), '0', '0', String(s.pf), '0'] })) }] });
      const pick = v => (typeof v === 'function' ? v(Number(url.match(/event=e(\d)/)[1])) : v);
      return { boxscore: { players: [side('PHI', pick(lines.PHI)), side('GS', pick(lines.GS))] } };
    }
    throw new Error('unexpected ' + url);
  };
}

test('names match across sources: accents, dots and Jr./III suffixes', () => {
  assert.equal(normName('Nikola Jokić'), normName('Nikola Jokic'));
  assert.equal(normName('V.J. Edgecombe'), normName('VJ Edgecombe'));
  assert.equal(normName('Jimmy Butler III'), normName('Jimmy Butler'));
  assert.equal(normName("Royce O'Neale"), 'royceoneale');
});

test('the formula is learned from the game players; hand-set players fall out', () => {
  const players = gamePlayers().map(p => ({ ...p, avg: { pts: p.averagePoints, reb: p.averageRebounds, ast: p.averageAssists, stl: p.averageSteals, blk: p.averageBlocks, to: p.averageTurnovers, pf: p.averageFoul } }));
  const m = fitModel(players);
  assert.ok(m.offense.mae <= 0.6, `offense error ${m.offense.mae}`);
  assert.ok(m.defense.mae <= 0.6, `defense error ${m.defense.mae}`);
  const t = rankTables([{ ranking: 2, value: 2470, rating: 'S+' }, { ranking: 1, value: 2500, rating: 'S+' }]);
  assert.deepEqual(t.value, [2500, 2470]);
});

test('the game\'s update rule: only 5 own games count, the move is capped by the rating tier; then compared with the update', async () => {
  const world = { players: gamePlayers() };
  let data = null;
  const logs = [];
  const store = { getValuePredict: () => data, saveValuePredict: v => { data = JSON.parse(JSON.stringify(v)); } };
  // Edgecombe plays all 5 games (big lines), Butler 4 (bad lines)
  const espn = fakeEspn({
    PHI: [['VJ Edgecombe', { min: 36, pts: 40, reb: 12, ast: 11, stl: 3, blk: 2, to: 2, pf: 2 }]],
    GS: [['Jimmy Butler', { min: 20, pts: 2, reb: 1, ast: 0, stl: 0, blk: 0, to: 3, pf: 4 }]]
  }, 5);
  const svc = new ValuePredictService({ store, activity: { add: e => logs.push(e) }, createSocket: fakeSocket(world), fetchJson: espn, now: () => Date.parse('2026-10-25T07:00:00Z') /* game 5 (10-24 23:00 UTC) ends before the 11:00 TR update */ });
  const snap = await svc.refresh();
  const ed = snap.rows.find(r => r.id === 'p3');
  assert.equal(ed.gp, 5);
  assert.equal(ed.eligible, true);
  // S tiers: a share of the current offense, at least 5 (S 4 %)
  const cap = capFor(snap.model.caps, ed.rating, ed.offense);
  assert.equal(cap, Math.max(5, Math.round(ed.offense * (ed.rating === 'S+' ? 0.03 : 0.04))));
  assert.equal(ed.predOffense - ed.offense, cap, 'a big jump is cut to the tier cap');
  assert.ok(ed.predRank <= ed.ranking);
  assert.equal(snap.rows.find(r => r.id === 'p6').season, null, 'no game: nothing from stats');

  // the game updates Edgecombe; the comparison keeps the prediction made before
  const p3 = world.players.find(p => p.id === 'p3');
  Object.assign(p3, { averagePoints: 40, averageRebounds: 12, averageAssists: 11, averageSteals: 3, averageBlocks: 2, averageTurnovers: 2, averageFoul: 2 });
  p3.offense = ed.predOffense; p3.defense = ed.predDefense;
  const before = p3.baseSalary;
  p3.baseSalary = ed.predValue;
  const after = await svc.refresh();
  const cmp = after.comparisons.find(c => c.id === 'p3');
  assert.equal(cmp.before, before);
  assert.equal(cmp.predicted, ed.change, 'the prediction made before the update is kept');
  assert.equal(cmp.actual, ed.predValue - before);
  assert.ok(logs.some(l => l.code === 'vp.gameUpdate'));
});

test('a player under 5 games is not updated; his value at game 5 is shown apart', async () => {
  const world = { players: gamePlayers() };
  let data = null;
  const store = { getValuePredict: () => data, saveValuePredict: v => { data = JSON.parse(JSON.stringify(v)); } };
  const espn = fakeEspn({ PHI: [['VJ Edgecombe', { min: 36, pts: 40, reb: 12, ast: 11, stl: 3, blk: 2, to: 2, pf: 2 }]], GS: [] }, 3);
  const svc = new ValuePredictService({ store, activity: { add() {} }, createSocket: fakeSocket(world), fetchJson: espn, now: () => Date.parse('2026-10-26T12:00:00Z') });
  const snap = await svc.refresh();
  const ed = snap.rows.find(r => r.id === 'p3');
  assert.equal(ed.gp, 3);
  assert.equal(ed.eligible, false);
  assert.equal(ed.predOffense, ed.offense, 'not recomputed before 5 own games');
  assert.ok(ed.atFive.offense > ed.offense, 'the game-5 level is shown apart');
});

test('averages are per game played: a missed game does not count', () => {
  const svc = new ValuePredictService({ store: { getValuePredict: () => null }, activity: null });
  const row = (pts, min = 30) => ['2026-10-20', 'e', min, pts, 0, 0, 0, 0, 0, 0, 0];
  const a = svc._avg([row(20), row(10), row(0, 0)], 'season');   // played 2, DNP 1
  assert.equal(a.gp, 2);
  assert.equal(a.pts, 15);
  assert.equal(svc._avg([row(0, 0)], 'season'), null);
  assert.equal(svc._avg([], 'season'), null);
});

test('caps: A+ and below a fixed number, the S tiers a share of the current value (at least 5)', () => {
  const caps = { 'A+': 12, B: 20 };
  assert.equal(capFor(caps, 'S+', 214), 6);
  assert.equal(capFor(caps, 'S+', 139), 5);
  assert.equal(capFor(caps, 'S', 188), 8);
  assert.equal(capFor(caps, 'S-', 155), 8);
  assert.equal(capFor(caps, 'S-', 89), 5);
  assert.equal(capFor(caps, 'A+', 150), 12);
  assert.equal(capFor(caps, 'B', 60), 20);
});

test('only the teams that play before the 11:00 update move by their own stats; the rest only by rank', async () => {
  const world = { players: gamePlayers() };
  let data = null;
  const store = { getValuePredict: () => data, saveValuePredict: v => { data = JSON.parse(JSON.stringify(v)); } };
  const espn = fakeEspn({ PHI: [['VJ Edgecombe', { min: 36, pts: 40, reb: 12, ast: 11, stl: 3, blk: 2, to: 2, pf: 2 }]], GS: [['Jimmy Butler', { min: 36, pts: 30, reb: 9, ast: 9, stl: 2, blk: 1, to: 1, pf: 1 }]] }, 5);
  // two days after the last game: no game in the window of the next update
  const svc = new ValuePredictService({ store, activity: { add() {} }, createSocket: fakeSocket(world), fetchJson: espn, now: () => Date.parse('2026-10-27T07:00:00Z') });
  const snap = await svc.refresh();
  assert.ok(snap.rows.every(r => !r.eligible), 'nobody played before this update');
  assert.ok(snap.rows.every(r => r.predOffense === r.offense && r.predDefense === r.defense));
  assert.ok(snap.rows.every(r => r.change === 0));
});

test('a missed game does not pull the average down; missing the window game means no update', async () => {
  const run = async PHI => {
    const world = { players: gamePlayers() };
    let data = null;
    const store = { getValuePredict: () => data, saveValuePredict: v => { data = JSON.parse(JSON.stringify(v)); } };
    // 6 games (10-20 … 10-25); the last one is in the window of the 10-26 11:00 TR update
    const svc = new ValuePredictService({ store, activity: { add() {} }, createSocket: fakeSocket(world), fetchJson: fakeEspn({ PHI, GS: [] }, 6), now: () => Date.parse('2026-10-26T07:00:00Z') });
    return (await svc.refresh()).rows.find(r => r.id === 'p3');
  };
  const line = { min: 36, pts: 18, reb: 6, ast: 6, stl: 2, blk: 1, to: 2, pf: 2 };
  const dnp = { min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 };
  const early = await run(game => [['VJ Edgecombe', game === 1 ? dnp : line]]);
  assert.equal(early.gp, 5);
  assert.ok(early.eligible, 'played the window game and has 5 games');
  assert.equal(early.season.pts, 18, 'the missed game is not counted');
  const late = await run(game => [['VJ Edgecombe', game === 5 ? dnp : line]]);
  assert.equal(late.gp, 5);
  assert.equal(late.eligible, false, 'did not play in the window: not recomputed');
  assert.equal(late.predOffense, late.offense);
});

test("the 5-game rule is the player's own: his team's 5 games are not enough", async () => {
  const world = { players: gamePlayers() };
  let data = null;
  const store = { getValuePredict: () => data, saveValuePredict: v => { data = JSON.parse(JSON.stringify(v)); } };
  const line = { min: 30, pts: 20, reb: 6, ast: 5, stl: 1, blk: 1, to: 2, pf: 2 };
  const dnp = { min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 };
  // team games 0-4, he plays only games 2-4
  const espn = fakeEspn({ PHI: game => [['VJ Edgecombe', game >= 2 ? line : dnp]], GS: [] }, 5);
  const svc = new ValuePredictService({ store, activity: { add() {} }, createSocket: fakeSocket(world), fetchJson: espn, now: () => Date.parse('2026-10-25T07:00:00Z') });
  const ed = (await svc.refresh()).rows.find(r => r.id === 'p3');
  assert.equal(ed.gp, 3);
  assert.equal(ed.eligible, false, 'only 3 games of his own');
  assert.equal(ed.season.pts, 20);
  assert.ok(ed.atFive, 'his level at game 5 is shown apart');
});
