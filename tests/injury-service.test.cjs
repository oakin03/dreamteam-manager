const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseInjuries, normName, nextRunAt } = require('../src/main/services/injury-service.cjs');

const NOW = Date.parse('2026-10-30T09:00:00Z');
const reply = { injuries: [{ displayName: 'Atlanta Hawks', injuries: [
  { status: 'Out', date: '2026-10-28', athlete: { displayName: 'Trae Young', team: { abbreviation: 'ATL' } }, details: { type: 'Knee', side: 'Left', returnDate: '2026-11-20' } },
  { status: 'Out', date: '2026-10-29', athlete: { displayName: 'Jalen Johnson', team: { abbreviation: 'ATL' } }, details: { type: 'Ankle', returnDate: '2026-11-01' } },
  { status: 'Day-To-Day', athlete: { displayName: 'Kristaps Porziņģis', team: { abbreviation: 'ATL' } }, details: { type: 'Illness' } }
] }] };

test('ESPN injuries: matched by name, red for out, orange for day-to-day or back within 3 days', () => {
  const list = parseInjuries(reply, NOW);
  assert.equal(list[normName('Trae Young')].level, 'out');
  assert.equal(list[normName('Trae Young')].returnDate, '2026-11-20');
  assert.equal(list[normName('Trae Young')].type, 'Left Knee');
  assert.equal(list[normName('Jalen Johnson')].level, 'soon');
  assert.equal(list[normName('Kristaps Porzingis')].level, 'soon');
  assert.equal(Object.keys(parseInjuries({}, NOW)).length, 0);
});

test('the injury list is read every day at 11:00 TR', () => {
  assert.equal(new Date(nextRunAt(Date.parse('2026-10-30T07:00:00Z'))).toISOString(), '2026-10-30T08:01:00.000Z');
  assert.equal(new Date(nextRunAt(Date.parse('2026-10-30T09:00:00Z'))).toISOString(), '2026-10-31T08:01:00.000Z');
});
