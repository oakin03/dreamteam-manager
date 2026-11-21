const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../default-tasks/task1-quick-play/index.cjs');

// Quick Play over the salary cap (user 2026-11-13): with Auto Trade making room it waits and tries
// again; without it, it stops with the alert as before.
function harness({ capTimes, capWait }) {
  const controller = new AbortController();
  const logs = [], alerts = [];
  let quickPlays = 0;
  const socket = {
    connected: true,
    timeout: () => ({
      emit: (event, payload, cb) => setTimeout(() => {
        if (event === 'quickPlay') { quickPlays++; return cb(null, quickPlays <= capTimes ? { success: false, error: 'Your team is over the salary cap.' } : { success: true }); }
        cb(null, { success: true, match: { status: 'started', host: 'u1', opponent: 'o1', opponentName: 'Opp' } });
      }, 1)
    })
  };
  const abort = () => { const e = new Error('Aborted'); e.name = 'AbortError'; return e; };
  const ctx = {
    signal: controller.signal, config: {}, log: (level, message) => logs.push({ level, message }), alert: (k, m) => alerts.push(k),
    setState() {}, ownUserIds: () => new Set(),
    // the first wait after a success ends the run
    sleep: async () => { controller.abort(); throw abort(); },
    capWait
  };
  return { go: () => run(ctx, { mode: 'socket', socket, userId: 'u1' }), logs, alerts, plays: () => quickPlays };
}

test('quick play: over the cap while Auto Trade makes room → waits and tries again, then plays on', async () => {
  const waits = [];
  const h = harness({ capTimes: 2, capWait: async attempt => { waits.push(attempt); return true; } });
  await assert.rejects(h.go(), e => e.name === 'AbortError');
  assert.deepEqual(waits, [1, 2]);
  assert.equal(h.plays(), 3);
  assert.deepEqual(h.alerts, []);
  assert.ok(h.logs.some(l => /Back under the salary cap/.test(l.message)));
});

test('quick play: over the cap without Auto Trade → stops with the salary-cap alert', async () => {
  const h = harness({ capTimes: 5, capWait: async () => false });
  await assert.rejects(h.go(), e => e.salaryCap === true && /salary cap/.test(e.message));
  assert.deepEqual(h.alerts, ['salary-cap']);
  assert.equal(h.plays(), 1);
});

// Injured starter (user 2026-11-21): when the guard cannot swap / heal, Quick Play no longer waits
// silently (it looked like running) — it stops with an error the page shows with "Anesteziye git".
function injuredHarness({ fixed }) {
  const controller = new AbortController();
  const alerts = [], reports = [];
  let quickPlays = 0;
  const socket = {
    connected: true,
    timeout: () => ({
      emit: (event, payload, cb) => setTimeout(() => {
        if (event === 'quickPlay') { quickPlays++; return cb(null, quickPlays === 1 ? { success: false, error: 'A starter is injured and not healed: LeBron James.' } : { success: true }); }
        cb(null, { success: true, match: { status: 'started', host: 'u1', opponent: 'o1', opponentName: 'Opp' } });
      }, 1)
    })
  };
  const abort = () => { const e = new Error('Aborted'); e.name = 'AbortError'; return e; };
  const ctx = {
    signal: controller.signal, config: {}, log() {}, alert: k => alerts.push(k), setState() {}, ownUserIds: () => new Set(),
    sleep: async () => { controller.abort(); throw abort(); },
    injury: { report: async m => { reports.push(m); return fixed; }, waitClear: async () => { throw new Error('must not wait'); } }
  };
  return { go: () => run(ctx, { mode: 'socket', socket, userId: 'u1' }), alerts, reports, plays: () => quickPlays };
}

test('quick play: an injured starter the guard cannot fix → stops with an error (code injured), no silent wait', async () => {
  const h = injuredHarness({ fixed: false });
  await assert.rejects(h.go(), e => e.code === 'injured' && e.fatal === true && e.params.names === 'LeBron James' && /Anesthesia/.test(e.message));
  assert.deepEqual(h.alerts, ['injured']);
  assert.equal(h.reports.length, 1);
});

test('quick play: an injured starter the guard swapped / healed → no stop, it goes on to the next try', async () => {
  const h = injuredHarness({ fixed: true });
  // the run only ends through the test's own abort (in the pause before the next try), not with an error
  await assert.rejects(h.go(), e => e.name === 'AbortError');
  assert.deepEqual(h.alerts, []);
  assert.equal(h.reports.length, 1);
});
