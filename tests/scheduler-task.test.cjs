const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SchedulerService } = require('../src/main/services/scheduler.cjs');

function setup({ workers = {}, schedule = {} } = {}) {
  const steps = [];
  const logs = [];
  const accounts = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
  let schedules = [{
    id: 's1', name: 'Turnuva kaydı', taskName: 'Turnuva kaydı', taskId: 'tournament-register', scheduleType: 'task',
    accountIds: ['a', 'b'], startAt: new Date(Date.now() - 1000).toISOString(), preparationMinutes: 0,
    enabled: true, started: false, completed: false, ...schedule
  }];
  const engine = {
    workers: new Map(Object.entries(workers)),
    prepared: new Map(),
    async stopAccount(id) { steps.push(`stop:${id}`); this.workers.delete(id); },
    async startAccount(id, taskId, options) {
      steps.push(`start:${id}:${taskId}:${JSON.stringify(options.config)}:${options.visibleBrowser}`);
      if (taskId === 'task2-pvp') this.workers.set(id, { status: 'running', taskId, donePromise: Promise.resolve() });
    }
  };
  const store = {
    getAccounts: () => accounts,
    getSchedules: () => schedules,
    saveSchedules: next => { schedules = next.map(x => ({ ...x })); },
    getSettings: () => ({})
  };
  const scheduler = new SchedulerService({ store, engine, activity: { add: e => logs.push(e) }, onChanged: () => {} });
  return { scheduler, engine, steps, logs, schedule: () => schedules[0] };
}

const quickPlay = (config = { mode: 'x' }) => ({ status: 'running', taskId: 'task1-quick-play', taskName: 'Quick Play', visibleBrowser: true, config });

test('a task schedule stops running tasks, runs the task, then starts them again with their settings', async () => {
  const { scheduler, steps, logs, schedule } = setup({
    workers: { a: quickPlay({ q: 1 }), b: { status: 'running', taskId: 'task9-other', taskName: 'Other', visibleBrowser: false, config: { o: 2 } }, c: quickPlay() }
  });
  scheduler.registerBuiltin('tournament-register', async ids => { steps.push(`run:${ids.join(',')}`); });
  await scheduler.runTaskSchedule(schedule());
  assert.deepEqual(steps, [
    'stop:a', 'stop:b',
    'run:a,b',
    'start:a:task1-quick-play:{"q":1}:true',
    'start:b:task9-other:{"o":2}:false'
  ]);
  // Account c was not selected and was never touched.
  assert.ok(!steps.some(x => x.includes(':c')));
  assert.equal(schedule().completed, true);
  assert.equal(schedule().phase, 'done');
  assert.deepEqual(schedule().resume.map(r => r.accountId), ['a', 'b']);
  assert.ok(logs.every(l => l.taskName === 'Schedule'));
  assert.ok(logs.some(l => /task completed/.test(l.message)));
});

test('the preparation minutes are waited once, between stopping and running', async () => {
  const { scheduler, steps, schedule } = setup({ workers: { a: quickPlay() }, schedule: { preparationMinutes: 0.002 } });
  let ranAt = 0;
  const t0 = Date.now();
  scheduler.registerBuiltin('tournament-register', async () => { ranAt = Date.now() - t0; steps.push('run'); });
  await scheduler.runTaskSchedule(schedule());
  assert.ok(ranAt >= 110 && ranAt < 600, `ran after ${ranAt}ms`);
  assert.deepEqual(steps.map(x => x.split(':')[0]), ['stop', 'run', 'start']);
});

test('cancelling during preparation skips the task and starts the stopped tasks again', async () => {
  const { scheduler, steps, logs, schedule } = setup({ workers: { a: quickPlay() }, schedule: { preparationMinutes: 1 } });
  scheduler.registerBuiltin('tournament-register', async () => { steps.push('run'); });
  const run = scheduler.runTaskSchedule(schedule());
  await new Promise(r => setTimeout(r, 30));
  scheduler.cancel('s1');
  await run;
  assert.deepEqual(steps.map(x => x.split(':')[0]), ['stop', 'start']);
  assert.ok(logs.some(l => l.level === 'warning' && /cancelled/.test(l.message)));
});

test('a failing task still starts the stopped tasks again', async () => {
  const { scheduler, steps, logs, schedule } = setup({ workers: { a: quickPlay() } });
  scheduler.registerBuiltin('tournament-register', async () => { throw new Error('boom'); });
  await scheduler.runTaskSchedule(schedule());
  assert.deepEqual(steps.map(x => x.split(':')[0]), ['stop', 'start']);
  assert.ok(logs.some(l => l.level === 'error' && /failed: boom/.test(l.message)));
  assert.equal(schedule().completed, true);
});

test('plugin task schedules run the task on each account and wait for it', async () => {
  const { scheduler, steps, schedule } = setup({ workers: { a: quickPlay() }, schedule: { taskId: 'task2-pvp', taskName: 'PvP' } });
  await scheduler.runTaskSchedule(schedule());
  assert.deepEqual(steps, ['stop:a', 'start:a:task2-pvp:null:false', 'start:b:task2-pvp:null:false', 'start:a:task1-quick-play:{"mode":"x"}:true']);
});

test('tick starts a task schedule once at its time, not before', async () => {
  const { scheduler, schedule } = setup({ schedule: { startAt: new Date(Date.now() + 60000).toISOString() } });
  let runs = 0;
  scheduler.runTaskSchedule = async () => { runs++; };
  await scheduler.tick();
  assert.equal(runs, 0);
  schedule().startAt = new Date(Date.now() - 1000).toISOString();
  await scheduler.tick();
  await scheduler.tick();
  assert.equal(runs, 1);
  assert.equal(schedule().started, true);
});

test('after a restart, an interrupted schedule starts again what it had stopped', async () => {
  const { scheduler, steps, logs, schedule } = setup({ schedule: { started: true, phase: 'running', resume: [
    { accountId: 'a', taskId: 'task1-quick-play', taskName: 'Quick Play', visibleBrowser: true, config: { q: 1 } }
  ] } });
  await scheduler.recover();
  assert.deepEqual(steps, ['start:a:task1-quick-play:{"q":1}:true']);
  assert.equal(schedule().completed, true);
  assert.equal(schedule().result, 'interrupted');
  assert.ok(logs.some(l => l.code === 'sc.interrupted'));
});

test('old Auto Play schedules are switched off and never run', async () => {
  const { scheduler, steps, logs, schedule } = setup({ schedule: { scheduleType: 'autoplay', taskId: 'task1-quick-play' } });
  await scheduler.recover();
  await scheduler.tick();
  assert.deepEqual(steps, []);
  assert.equal(schedule().enabled, false);
  assert.ok(logs.some(l => l.code === 'sc.autoplayDisabled'));
});

test('other services on the accounts stop before the task (and their Auto Play is caught) and start again after it', async () => {
  const { scheduler, engine, steps, schedule } = setup({ workers: {} });
  // Stopping Auto Buy gives back the Auto Play it had paused on account a.
  scheduler.pauseServices = async ids => {
    steps.push(`pauseServices:${ids.join(',')}`);
    engine.workers.set('a', quickPlay());
    return async () => { steps.push('resumeServices'); };
  };
  scheduler.registerBuiltin('tournament-register', async () => { steps.push('run'); });
  await scheduler.runTaskSchedule(schedule());
  assert.deepEqual(steps, ['pauseServices:a,b', 'stop:a', 'run', 'start:a:task1-quick-play:{"mode":"x"}:true', 'resumeServices']);
});
