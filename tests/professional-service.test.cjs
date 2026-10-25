const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ProfessionalService } = require('../src/main/services/proving-service.cjs');

// Fake Professional mode: season / playoffs / HOF reads on /socket/, matches on /simulation-socket/.
function fakeGame({ season = 'none', played = 0, left = 2, propsUsed = 0, cards = 0, results = [], hof = null, playoffs = null } = {}) {
  const state = { season, played, left, propsUsed, cards, results: [...results], hof, playoffs, active: 0, matches: [], emitted: [] };
  const schedule = () => state.season === 'none' ? [] : Array.from({ length: 82 }, (_, i) => ({
    id: 's' + (i + 1), gameNumber: i + 1, status: i < state.played ? 'COMPLETED' : 'SCHEDULED', opponentId: 'bot' + (i + 1),
    opponent: { teamName: 'Bot ' + (i + 1) }, match: i < state.played ? { winnerId: state.wins?.has(i + 1) ? 'u1' : 'bot' } : null
  }));
  state.wins = new Set();
  const createSocket = (_u, options) => {
    const s = new EventEmitter();
    s.connected = true; s.off = s.removeListener; s.close = () => { s.connected = false; };
    const local = (...a) => EventEmitter.prototype.emit.apply(s, a);
    s.emit = (event, p) => {
      state.emitted.push(event);
      setImmediate(() => {
        if (event === 'prof:load') local('professionalUserData', { success: true, dailyProfessionalMatches: state.left, propsRefillsUsed: state.propsUsed, profMatchCards: state.cards, refillsUsed: 0, professionalSeasonCompleted: state.season !== 'none' && state.played >= 82 });
        if (event === 'hof:loadTeams') return state.hof ? local('hof:loadTeamsSuccess', { hofSeason: { isCompleted: state.hof.every(t => t.defeated) }, teams: state.hof.map(t => ({ teamUserId: t.id, displayName: t.name, status: t.defeated ? 'DEFEATED' : 'AVAILABLE' })), attempts: { dailyProfessionalMatches: state.left } }) : local('hof:loadTeamsError', { error: 'No active HOF season found for user' });
        if (event === 'honorway:loadTeams' || event === 'legacyway:loadTeams') {
          const kind = event.startsWith('honor') ? 'honor' : 'legacy';
          const way = state[kind];
          return way ? local(`${event}Success`, { [kind === 'honor' ? 'honorWaySeason' : 'legacyWaySeason']: { isCompleted: way.every(t => t.defeated) }, teams: way.map(t => ({ teamUserId: t.id, displayName: t.name, order: t.order, status: t.defeated ? 'DEFEATED' : 'AVAILABLE' })) }) : local(`${event}Error`, { error: 'No active season' });
        }
        if (event === 'playoffs:reset') { state.resets = (state.resets || 0) + 1; state.playoffs = null; state.played = 0; state.wins = new Set(); local('playoffs:resetSuccess', { success: true }); }
        if (event === 'season:reset') { state.season = 'none'; state.played = 0; local('season:resetSuccess', { success: true }); }
        if (event === 'hof:createHonorWaySeason') { state.honor = [{ id: 'w2', name: 'Dream 2', order: 2 }, { id: 'w1', name: 'Dream 1', order: 1 }]; local('hof:createHonorWaySeasonSuccess', { success: true }); }
        if (event === 'honorway:createLegacyWaySeason') { state.legacy = [{ id: 'l1', name: 'Legacy 1', order: 1 }]; local('honorway:createLegacyWaySeasonSuccess', { success: true }); }
        if (event === 'season:loadSchedule') local('season:loadScheduleSuccess', { schedule: schedule() });
        if (event === 'season:checkConference') local('season:checkConferenceSuccess', { conference: null });
        if (event === 'season:selectConference') { state.conference = p.conference; local('season:selectConferenceSuccess', { success: true }); }
        if (event === 'season:generateSchedule') { state.season = 'on'; local('season:generateScheduleSuccess', { success: true }); }
        if (event === 'season:generatePlayoffs') { state.playoffs = state.playoffs || []; local('season:generatePlayoffsSuccess', { success: true }); }
        if (event === 'playoff:loadEast') local('playoff:loadEastSuccess', { playoff: state.playoffs ? { brackets: state.playoffs } : null });
        if (event === 'playoff:loadWest') local('playoff:loadWestSuccess', { playoff: null });
        if (event === 'prof:refillProps') { state.propsUsed++; state.cards--; state.left += 2; local('refillPropsSuccess', { success: true }); }
        if (event === 'getTeamInfo') local('teamInfoData', { success: true, userId: p.userId, teamName: p.userId, players: { starters: [{ offense: 100, defense: 90 }], bench: [{ offense: 10, defense: 5, equippedItems: { a: { offenseBoost: 3 } } }] } });
      });
      return true;
    };
    s.timeout = () => ({ emit: (event, p, cb) => setImmediate(() => {
      if (event === 'getUserActiveMatch') {
        if (state.active > 0) { state.active--; if (state.active === 0) state.pending?.(); return cb(null, { success: true, match: { match_id: 'm' } }); }
        return cb(null, { success: true, match: null });
      }
      if (['playProfessionalMatch', 'playHOFMatch', 'playHonorWayMatch'].includes(event)) {
        if (state.left <= 0) return cb(null, { success: false, error: 'No matches left' });
        state.matches.push({ event, p });
        state.left--;
        const win = state.results.shift();
        state.active = 2;
        state.pending = () => {
          if (event === 'playHOFMatch') { if (win) state.hof.find(t => t.id === p.opponentId).defeated = true; return; }
          if (event === 'playHonorWayMatch') { if (win) state.honor.find(t => t.id === p.opponentId).defeated = true; return; }
          if (p.matchType === 'PLAYOFF') { for (const b of state.playoffs) for (const g of b.games) if (g.id === p.scheduleId) { g.status = 'COMPLETED'; g.winnerId = win ? 'u1' : 'x'; } return; }
          state.played++; if (win) state.wins.add(state.played);
        };
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
  return { logs, settings: () => settings, d: { store, activity: { add: e => logs.push(e) }, sessions: { get: async () => ({ userId: 'u1', cookieHeader: 'c=1' }) }, createSocket: game.createSocket, random: () => 0.7, timing: { pollMs: 1, appearGraceMs: 50 } } };
}

test('Professional starts a new season (random conference) and plays the scheduled games until the matches run out', async () => {
  const game = fakeGame({ season: 'none', left: 2, results: [true, false] });
  const { d, logs, settings } = deps(game);
  await new ProfessionalService(d).runAndWait({ a1: true });
  assert.equal(game.state.conference, 'WEST');
  assert.deepEqual(game.state.matches.map(m => m.p), [{ userId: 'u1', opponentId: 'bot1', scheduleId: 's1' }, { userId: 'u1', opponentId: 'bot2', scheduleId: 's2' }]);
  assert.deepEqual(logs.filter(l => /matchWon|matchLost/.test(l.code)).map(l => l.code), ['pf.matchWon', 'pf.matchLost']);
  const row = settings().professionalReport.rows[0];
  assert.deepEqual({ status: row.status, played: row.played, won: row.won }, { status: 'done', played: 2, won: 1 });
  assert.ok(!game.state.emitted.includes('prof:refillTickets'), 'TIX refills are never used');
});

test('Professional uses Prof Match Cards (max 2 refills a day), never TIX', async () => {
  const game = fakeGame({ season: 'on', played: 10, left: 0, propsUsed: 1, cards: 3, results: [true, true, true] });
  const { d, logs } = deps(game);
  await new ProfessionalService(d).runAndWait({ a1: true });
  assert.equal(game.state.propsUsed, 2, 'only one more refill fits today');
  assert.equal(game.state.matches.length, 2);
  assert.ok(logs.some(l => l.code === 'pf.refilled'));
  assert.ok(!game.state.emitted.includes('prof:refillTickets'));
});

test('Professional creates the playoffs after game 82 and plays the open series game', async () => {
  const playoffs = [{ round: 'FIRST_ROUND', status: 'IN_PROGRESS', team1: { id: 'u1' }, team2: { id: 'p2', teamName: 'Celtics' }, games: [{ id: 'g1', status: 'SCHEDULED' }, { id: 'g2', status: 'SCHEDULED' }] }];
  const game = fakeGame({ season: 'on', played: 81, left: 2, results: [true, true] });
  game.state.nextPlayoffs = playoffs;
  const orig = game.createSocket;
  game.createSocket = (u, o) => { const s = orig(u, o); const em = s.emit; s.emit = (e, p) => { if (e === 'season:generatePlayoffs') game.state.playoffs = playoffs; return em(e, p); }; return s; };
  const { d, logs } = deps(game);
  await new ProfessionalService(d).runAndWait({ a1: true });
  assert.deepEqual(game.state.matches.map(m => m.p.scheduleId), ['s82', 'g1']);
  assert.equal(game.state.matches[1].p.matchType, 'PLAYOFF');
  assert.equal(game.state.matches[1].p.opponentId, 'p2');
  assert.ok(logs.some(l => l.code === 'pf.playoffsReady'));
});

test('Professional plays the Hall of Fame opponent the user chose and waits for a new pick after a win', async () => {
  const game = fakeGame({ season: 'on', left: 2, results: [false, true], hof: [{ id: 'h1', name: 'Bulls 96' }, { id: 'h2', name: 'Lakers 01' }] });
  const { d, settings } = deps(game);
  const svc = new ProfessionalService(d);
  await svc.status(['a1']);
  assert.equal(svc.info.a1.stage, 'hof');
  assert.deepEqual(svc.info.a1.teams.map(t => [t.id, t.off, t.def]), [['h1', 113, 95], ['h2', 113, 95]]);
  await svc.runAndWait({ a1: 'h2' });
  assert.deepEqual(game.state.matches.map(m => [m.event, m.p.opponentId, m.p.matchType]), [['playHOFMatch', 'h2', 'HOF'], ['playHOFMatch', 'h2', 'HOF']]);
  assert.equal(settings().professionalReport.rows[0].status, 'needPick');
});

test('Professional without a chosen HOF opponent plays nothing', async () => {
  const game = fakeGame({ hof: [{ id: 'h1', name: 'Bulls 96' }] });
  const { d, logs } = deps(game);
  await new ProfessionalService(d).runAndWait({ a1: true });
  assert.equal(game.state.matches.length, 0);
  assert.ok(logs.some(l => l.code === 'pf.needPick'));
});

test('Professional resets the playoffs after an elimination and goes back to the regular season', async () => {
  const playoffs = [{ round: 'FIRST_ROUND', status: 'COMPLETED', team1: { id: 'u1' }, team2: { id: 'p2' }, games: [1, 2, 3, 4].map(n => ({ id: 'g' + n, status: 'COMPLETED', winnerId: 'p2' })) }];
  const game = fakeGame({ season: 'on', played: 82, left: 1, results: [true], playoffs });
  const { d, logs } = deps(game);
  await new ProfessionalService(d).runAndWait({ a1: true });
  assert.equal(game.state.resets, 1);
  assert.ok(logs.some(l => l.code === 'pf.playoffReset'));
  assert.deepEqual(game.state.matches.map(m => m.p.scheduleId), ['s1']);
});

test('Professional opens the Honor Way after the Hall of Fame and plays its teams in order', async () => {
  const game = fakeGame({ season: 'on', left: 2, results: [true, true], hof: [{ id: 'h1', name: 'Bulls 96', defeated: true }] });
  const { d, logs } = deps(game);
  await new ProfessionalService(d).runAndWait({ a1: true });
  assert.ok(logs.some(l => l.code === 'pf.honorCreated'));
  assert.ok(logs.some(l => l.code === 'pf.legacyCreated'), 'Legacy Way opens after the Honor Way');
  assert.deepEqual(game.state.matches.map(m => [m.event, m.p.opponentId, m.p.matchType]), [['playHonorWayMatch', 'w1', 'HONOR_WAY'], ['playHonorWayMatch', 'w2', 'HONOR_WAY']]);
});
