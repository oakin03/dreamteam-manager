const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SynthesisService } = require('../src/main/services/synthesis-service.cjs');

// "Do both" (user 2026-11-24): No Team on every chosen level, then Team with the same levels —
// two ordinary runs, as if the two buttons were pressed one after the other.
function service({ failFirst = false } = {}) {
  const logs = []; const runs = [];
  const s = new SynthesisService({
    store: { getAccountProfile: () => ({ mainAccountId: 'a1' }), getAccounts: () => [{ id: 'a1', name: 'Main' }], getSettings: () => ({}), getSynthesisData: () => ({}), saveSynthesisData() {} },
    activity: { add: e => logs.push(e) }, sessions: {}, onChanged() {}, onDone: async () => {}
  });
  s._run = async (account, signal) => {
    runs.push({ mode: s.run.mode, levels: s.run.levels });
    await new Promise(r => setTimeout(r, 5));
    if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (failFirst && runs.length === 1) throw new Error('boom');
  };
  return { s, logs, runs };
}
const settle = async s => { for (let i = 0; i < 50 && (s.controller || s.chain); i++) await new Promise(r => setTimeout(r, 5)); await s.done; };

test('synthesis both: No Team first, then Team with the same levels', async () => {
  const { s, runs } = service();
  const snap = s.start({ mode: 'both', levels: [1, 2, 3] });
  assert.equal(snap.running, true);
  assert.equal(s.snapshot().then, 'team');
  await settle(s);
  assert.deepEqual(runs.map(r => r.mode), ['noTeam', 'team']);
  assert.deepEqual(runs[1].levels, runs[0].levels);
  assert.equal(s.snapshot().running, false);
  assert.equal(s.run.status, 'done');
});

test('synthesis both: a stop during No Team does not start Team; an error neither', async () => {
  const a = service();
  a.s.start({ mode: 'both', levels: [1] });
  a.s.stop();
  await settle(a.s);
  assert.deepEqual(a.runs.map(r => r.mode), ['noTeam']);
  const b = service({ failFirst: true });
  b.s.start({ mode: 'both', levels: [1] });
  await settle(b.s);
  assert.deepEqual(b.runs.map(r => r.mode), ['noTeam']);
});
