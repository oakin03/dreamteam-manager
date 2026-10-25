const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AutoPlayStop } = require('../src/main/services/autoplay-stop.cjs');

// 2026-10-23 14:55 TR = 11:55 UTC
const at = hhmm => Date.parse(`2026-10-23T${String(Number(hhmm.slice(0, 2)) - 3).padStart(2, '0')}:${hhmm.slice(3)}:20Z`);

function setup(settings) {
  const steps = []; const logs = []; const attention = [];
  let s = { ...settings };
  const engine = {
    workers: new Map([['a', { status: 'running', taskId: 'task1-quick-play', taskName: 'Quick Play', visibleBrowser: false, config: { m: 1 } }], ['b', { status: 'stopped', taskId: 'task1-quick-play' }]]),
    prepared: new Map(),
    async stopAccount(id) { steps.push('stop:' + id); this.workers.get(id).status = 'stopped'; },
    async startAccount(id, taskId, o) { steps.push(`start:${id}:${taskId}:${JSON.stringify(o.config)}`); this.workers.get(id).status = 'running'; }
  };
  let now = at('14:50');
  const svc = new AutoPlayStop({ store: { getSettings: () => s, saveSettings: v => { s = v; }, getAccounts: () => [{ id: 'a' }, { id: 'b' }] }, engine, activity: { add: e => logs.push(e) }, onAttention: k => attention.push(k), now: () => now });
  return { svc, steps, logs, attention, setNow: v => { now = v; }, settings: () => s };
}

test('stops running Auto Play once at the set TR time, then starts the same ones again at the restart time', async () => {
  const { svc, steps, logs, attention, setNow, settings } = setup({ autoPlayStop: { enabled: true, stopAt: '14:55', resumeEnabled: true, resumeAt: '16:00' } });
  await svc.tick();
  assert.deepEqual(steps, [], 'not yet');
  setNow(at('14:55')); await svc.tick();
  setNow(at('14:56')); await svc.tick();
  assert.deepEqual(steps, ['stop:a'], 'only the running account, only once');
  assert.ok(logs.some(l => l.code === 'ap.dailyStop' && l.params.count === 1));
  assert.deepEqual(attention, ['autoPlayStop']);
  setNow(at('16:00')); await svc.tick();
  assert.deepEqual(steps, ['stop:a', 'start:a:task1-quick-play:{"m":1}']);
  assert.equal(settings().autoPlayStopState.stopped.length, 0);
});

test('disabled does nothing; an app started long after the stop time does not stop anything', async () => {
  const off = setup({ autoPlayStop: { enabled: false, stopAt: '14:55' } });
  off.setNow(at('14:55')); await off.svc.tick();
  assert.deepEqual(off.steps, []);
  const late = setup({ autoPlayStop: { enabled: true, stopAt: '14:55' } });
  late.setNow(at('18:00')); await late.svc.tick();
  assert.deepEqual(late.steps, []);
});

test('daily tournament line: on by default at 15:48, once a day, independent of the Auto Play stop; off when unticked', async () => {
  const runs = [];
  const make = settings => {
    const t = setup(settings);
    t.svc.scheduleTournament = async () => { runs.push('tn'); return { accountIds: ['a', 'b'] }; };
    return t;
  };
  const on = make({ autoPlayStop: { enabled: false } });
  on.setNow(at('15:47')); await on.svc.tick();
  assert.deepEqual(runs, []);
  on.setNow(at('15:48')); await on.svc.tick();
  on.setNow(at('15:50')); await on.svc.tick();
  assert.deepEqual(runs, ['tn'], 'once, although the Auto Play stop is off');
  assert.deepEqual(on.steps, [], 'the tournament line stops nothing itself (the scheduler does)');
  assert.ok(on.logs.some(l => l.code === 'ap.dailyTournament' && l.params.count === 2));
  const off = make({ dailyTournament: { enabled: false, at: '15:48' } });
  off.setNow(at('15:48')); await off.svc.tick();
  assert.deepEqual(runs, ['tn']);
});

test('daily PVP line: on by default at 05:01, once a day, independent of the tournament line', async () => {
  const t = setup({ dailyTournament: { enabled: false } });
  const runs = [];
  t.svc.schedulePvp = async () => { runs.push('pvp'); return { accountIds: ['a'] }; };
  t.svc.scheduleTournament = async () => { runs.push('tn'); return { accountIds: [] }; };
  t.setNow(at('05:00')); await t.svc.tick();
  t.setNow(at('05:01')); await t.svc.tick();
  t.setNow(at('05:05')); await t.svc.tick();
  assert.deepEqual(runs, ['pvp']);
  assert.ok(t.logs.some(l => l.code === 'ap.dailyPvp' && l.params.count === 1));
});
