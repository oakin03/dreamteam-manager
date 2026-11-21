const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TournamentLive, isWalkover } = require('../src/main/services/tournament-live.cjs');

// Shapes as read live on 2026-11-13 (EXCLUSIVE MATCH - Elite).
function make() {
  const store = {
    getAccounts: () => [{ id: 'A', name: 'Acc A' }, { id: 'B', name: 'Acc B' }],
    getAccountProfile: () => ({ accounts: { A: { userId: 'ua' }, B: { userId: 'ub' } } }),
    getSettings: () => ({}), saveSettings() {}
  };
  const tl = new TournamentLive({ store, activity: { add() {} }, engine: null, now: () => 1000 });
  tl.live.set('e1', { id: 'e1', name: 'Elite', totalRounds: 7, list: { registrations: [{ userId: 'ua' }, { userId: 'ub' }, { userId: 'x' }] }, data: null, seconds: null, results: new Map(), walkovers: new Map() });
  return tl;
}

test('tournament live: walkovers, eliminations and the live score / result per round', async () => {
  const tl = make();
  tl.evSock = { socket: { connected: true }, call: async () => ({
    currentRound: 1,
    participants: [{ userId: 'ua', eliminatedAt: null }, { userId: 'ub', eliminatedAt: '2026-11-13T12:00:03Z' }],
    ongoingMatches: [
      { id: 'm1', roundNumber: 1, aUserId: 'ub', bUserId: 'x', winnerUserId: 'x', aScore: 0, bScore: 25, aUser: { teamName: 'Acc B' }, bUser: { teamName: 'Other' } },
      { id: 'm2', roundNumber: 1, aUserId: 'ua', bUserId: 'y', winnerUserId: null, aScore: 0, bScore: 0, aUser: { teamName: 'Acc A' }, bUser: { teamName: 'Rival' } }
    ]
  }) };
  await tl._eventData('e1');
  tl.matchIndex.set('mp-1', { eventId: 'e1', round: 1, host: 'ua', opponent: 'y' });
  tl._onMatch({ match_id: 'mp-1', quarter: 3, timeLeft: '05:00', hostTeam: { userId: 'ua', score: 50 }, opponentTeam: { userId: 'y', score: 41 } }, false);
  let rows = tl.rows();
  const a = rows.find(r => r.accountId === 'A'); const b = rows.find(r => r.accountId === 'B');
  assert.equal(a.opponent, 'Rival');
  assert.deepEqual([a.score, a.oppScore, a.quarter], [50, 41, 3]);
  assert.equal(b.walkover, true); assert.equal(b.won, false); assert.equal(b.out, true);
  tl._onMatch({ match_id: 'mp-1', hostScore: 88, opponentScore: 80, winner: 'ua' }, true);
  rows = tl.rows();
  const h = rows.find(r => r.accountId === 'A').history[0];
  assert.deepEqual([h.round, h.opp, h.my, h.their, h.won, h.done], [1, 'Rival', 88, 80, true, true]);
  const ev = tl.snapshot().events[0];
  assert.equal(ev.walkovers.length, 1);
  assert.equal(ev.walkovers[0].ours, true);
  assert.ok(isWalkover(25, 0) && !isWalkover(25, 3));
});

test('tournament live: rotation on for every account unless switched off', () => {
  let saved = {};
  const tl = make();
  tl.store.getSettings = () => saved; tl.store.saveSettings = s => { saved = s; };
  assert.equal(tl.rotationOn('A'), true);
  tl.setRotation(['A'], false);
  assert.equal(tl.rotationOn('A'), false);
  assert.equal(tl.rotationOn('B'), true);
  tl.setRotation(['A'], true);
  assert.equal(tl.rotationOn('A'), true);
});
