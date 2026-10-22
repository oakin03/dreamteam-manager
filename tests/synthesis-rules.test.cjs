const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/main/services/synthesis-rules.cjs');

const row = (id, playerId, name, level, quantity, { team = true, x = false } = {}) => ({ id, itemId: 'it-' + level, quantity, item: { level, linkedPlayerId: playerId, linkedPlayer: { id: playerId, name, rating: x ? 'X' : 'B', type: x ? 'XPLAYER' : 'CURRENT', starCardTeamAssignment: team ? [{ teamId: 1 }] : [] } } });

test('stacks: team from the game assignment, X players flagged', () => {
  const s = R.stacksFrom([row('a', 'p1', 'Jokic', 1, 9), row('b', 'p2', 'Nobody', 1, 3, { team: false }), row('c', 'p3', 'X Doncic', 2, 5, { x: true })]);
  assert.deepEqual(s.map(v => [v.name, v.noTeam, v.x]), [['Jokic', false, false], ['Nobody', true, false], ['X Doncic', false, true]]);
});

test('team candidates: same player ≥4 at the level, X never', () => {
  const s = R.stacksFrom([row('a', 'p1', 'Jokic', 1, 9), row('b', 'p2', 'Curry', 1, 3), row('c', 'p3', 'X', 1, 8, { x: true }), row('d', 'p4', 'Embiid', 2, 4)]);
  assert.deepEqual(R.teamCandidates(s, 1).map(v => [v.name, Math.floor(v.quantity / 4)]), [['Jokic', 2]]);
  assert.deepEqual(R.teamCandidates(s, 2).map(v => v.name), ['Embiid']);
});

test('No Team pick: quantity first, then alphabetical, 4 different players; fewer than 4 → null', () => {
  const s = R.stacksFrom([
    row('a', 'p1', 'Zed', 1, 10, { team: false }),
    ...['Eve', 'Bob', 'Dan', 'Cal', 'Abe'].map((n, i) => row('b' + i, 'q' + i, n, 1, 9, { team: false })),
    row('c', 'p9', 'Amy', 1, 2, { team: false }),
    row('d', 'pt', 'Team guy', 1, 20)
  ]);
  assert.deepEqual(R.noTeamPick(s, 1).map(v => v.name), ['Zed', 'Abe', 'Bob', 'Cal']);
  assert.equal(R.noTeamPick(R.stacksFrom([row('a', 'p1', 'A', 2, 9, { team: false }), row('b', 'p2', 'B', 2, 9, { team: false }), row('c', 'p3', 'C', 2, 1, { team: false })]), 2), null);
  const cards = R.selectedCards(R.noTeamPick(s, 1));
  assert.deepEqual(cards[0], { inventoryId: 'a', itemId: 'it-1', linkedPlayerId: 'p1', level: 1 });
});
