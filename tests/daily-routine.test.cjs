const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { DailyRoutineService } = require('../src/main/services/daily-routine-service.cjs');
const { TaskEngine } = require('../src/main/services/task-engine.cjs');

const USER = 'u1';
const NOW = Date.parse('2026-10-21T17:00:00Z'); // 20:00 TR, after the 19:10 reset

// Fake game: /socket/ (events + acks), /simulation-socket/ (acks) and the 600-day HTTP API.
function fakeGame(opts = {}) {
  const calls = [];
  const state = {
    signInClaimed: Boolean(opts.signInClaimed), signed600: Boolean(opts.signed600), tasksStarted: Boolean(opts.tasksStarted),
    fmDone: Boolean(opts.fmDone), matches: opts.matches ? opts.matches.map(m => ({ ...m })) : [],
    active: null, pending: null, hidden: 0, claimed: new Set(opts.claimed || []), claimCooldownOnce: Boolean(opts.claimCooldownOnce), activeLeft: 0, pendingPolls: 0, otherMatch: opts.otherMatch || 0,
    mails: (opts.mails || []).map(m => ({ ...m }))
  };
  const tasks = () => [
    { taskId: 't-pk', task: { key: 'win_1_match' }, completed: Boolean(opts.pkDone), isClaimed: state.claimed.has('t-pk') },
    { taskId: 't-fm', task: { key: 'friendly_match' }, completed: state.fmDone, isClaimed: state.claimed.has('t-fm') }
  ];
  const sim = (event, p) => {
    if (event === 'getUserActiveMatch') {
      if (state.otherMatch > 0) { state.otherMatch--; return { success: true, match: { match_id: 'match-1', type: 'QP' } }; }
      // Like the game: a joined match can take a few polls to show up.
      if (state.active && state.hidden > 0) { state.hidden--; return { success: true, match: null }; }
      if (state.active && --state.activeLeft < 0) { state.active = null; state.fmDone = true; }
      return { success: true, match: state.active };
    }
    if (event === 'requestMatchList') {
      if (state.pending && opts.opponentAfter != null && ++state.pendingPolls > opts.opponentAfter) {
        state.active = { ...state.pending, status: 'started', opponentName: 'Rival' }; state.pending = null; state.activeLeft = 2;
      }
      return { success: true, myActive: state.hidden > 0 ? null : state.active, myPending: state.pending, matches: state.matches };
    }
    if (event === 'joinFM') {
      const m = state.matches.find(x => x.match_id === p.matchId);
      if (opts.joinFails?.includes(p.matchId)) return { success: false, error: 'Match is full' };
      state.active = { ...m, status: 'started' }; state.activeLeft = 2; state.hidden = opts.hiddenPolls || 0;
      return { success: true, matchId: p.matchId };
    }
    if (event === 'createFM') { state.pending = { match_id: 'fm-own', host: USER, status: 'waiting', type: 'FM' }; return { success: true, matchId: 'fm-own' }; }
    if (event === 'cancelMatch') { state.pending = null; return { success: true }; }
    return { success: false, error: 'unknown' };
  };
  const main = (event, p, reply) => {
    if (event === 'getSignInStatus') return reply('dailySignIn:data', { hasClaimedToday: state.signInClaimed, currentDay: 22 });
    if (event === 'claimSignInReward') {
      if (state.signInClaimed) return reply('dailySignIn:error', 'Already signed in today.');
      state.signInClaimed = true; return reply('dailySignIn:claimed', { currentDay: 22 });
    }
  };
  const mainAck = (event, p) => {
    if (event === 'getUserMails') return { success: true, mails: state.mails };
    if (event === 'claimAllMailItems') { for (const m of state.mails) m.isClaimed = true; return { success: true, message: 'Claimed' }; }
    if (event === 'getDailyTasks') return state.tasksStarted ? { tasks: tasks() } : { needsStart: true };
    if (event === 'startDailyTasks') { state.tasksStarted = true; return { tasks: tasks(), success: true }; }
    if (event === 'claimAllDailyTaskRewards' || event === 'claimDailyTaskReward') {
      if (state.claimCooldownOnce) { state.claimCooldownOnce = false; return { success: false, error: 'Please wait 1 seconds before trying again.', retryAfter: 0 }; }
      const ready = tasks().filter(t => t.completed && !t.isClaimed);
      if (event === 'claimDailyTaskReward') {
        const t = ready.find(x => x.taskId === p.taskId);
        if (!t) return { success: false, error: 'Task not found or not eligible for claiming' };
        state.claimed.add(t.taskId);
        return { success: true, taskId: t.taskId, rewards: [{ type: 'XP', amount: 250 }, { type: 'ITEM', amount: 5, item: { name: 'Rare Fabric' } }] };
      }
      if (!ready.length) return { success: false, error: 'No completed tasks to claim' };
      for (const t of ready) state.claimed.add(t.taskId);
      return { success: true, claimedCount: ready.length, rewards: { xp: 250 * ready.length, items: [{ itemName: 'Rare Fabric', amount: 5 * ready.length }] } };
    }
  };
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.close = () => { s.closed = true; };
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    const path = options.path;
    s.emit = (event, payload) => {
      calls.push({ path, event, payload });
      main(event, payload, (name, data) => setTimeout(() => !s.closed && emitLocal(name, data), 1));
      return true;
    };
    s.timeout = () => ({
      emit: (event, payload, cb) => {
        calls.push({ path, event, payload });
        const data = path === '/simulation-socket/' ? sim(event, payload) : mainAck(event, payload);
        setTimeout(() => cb(null, data), 1);
      }
    });
    setTimeout(() => emitLocal('connect'), 1);
    return s;
  };
  const fetchImpl = async (url, init) => {
    calls.push({ path: 'http', event: url.split('/').pop(), payload: JSON.parse(init.body) });
    if (state.signed600) return { status: 400, json: async () => ({ success: false, error: 'Already signed in today' }) };
    state.signed600 = true;
    return { status: 200, json: async () => ({ success: true, data: { progress: { currentDay: 22 } } }) };
  };
  return { createSocket, fetchImpl, calls, state };
}

function routine(game, { selected = ['a1'], timing = {} } = {}) {
  const logs = [];
  const mem = { settings: { dailyRoutineAccountIds: selected }, daily: { version: 1, accounts: {} } };
  const store = {
    getSettings: () => mem.settings, getAccounts: () => [{ id: 'a1', name: 'Trophy6' }],
    getDailyRoutine: () => mem.daily, saveDailyRoutine: v => { mem.daily = v; }
  };
  const s = new DailyRoutineService({
    store, activity: { add: e => logs.push(e) }, onChanged() {},
    sessions: { get: async () => ({ userId: USER, cookieHeader: 'session=x' }), invalidate() {} },
    createSocket: game.createSocket, fetchImpl: game.fetchImpl, now: () => NOW,
    timing: { pollMs: 2, appearMs: 1e9, busyRetryMs: 2, busyWaitMs: 1e9, opponentWaitMs: 1e9, matchWaitMs: 1e9, totalMs: 1e9, ...timing }
  });
  return { s, logs, mem };
}
const account = { id: 'a1', name: 'Trophy6' };
const codes = logs => logs.map(l => l.code);
const fm = (id, extra = {}) => ({ match_id: id, host: `h-${id}`, hostName: `Host ${id}`, opponent: null, status: 'waiting', type: 'FM', hasPassword: false, ...extra });

test('fresh day: claims, signs in, starts tasks, joins an open match and waits for its end', async () => {
  const game = fakeGame({ matches: [fm('fm-locked', { hasPassword: true }), fm('fm-full'), fm('fm-open'), fm('fm-started', { status: 'started', opponent: 'x' })], joinFails: ['fm-full'] });
  const { s, logs, mem } = routine(game);
  const results = await s.runIfDue(account);
  assert.deepEqual(results, { signIn: 'claimed', signIn600: 'signed', tasks: 'started', friendly: 'played' });
  const joins = game.calls.filter(c => c.event === 'joinFM').map(c => c.payload.matchId);
  assert.deepEqual(joins, ['fm-full', 'fm-open'], 'never tries the passworded or started match');
  assert.ok(!game.calls.some(c => c.event === 'createFM'));
  assert.ok(!game.calls.some(c => c.event === 'register'), 'no register: it would kick the game page');
  assert.deepEqual(codes(logs), ['dr.start', 'dr.signIn', 'dr.signIn600', 'dr.tasksStarted', 'dr.fmJoinFailed', 'dr.fmJoined', 'dr.fmDone', 'dr.rewardsClaimed', 'dr.done']);
  assert.deepEqual(game.calls.filter(c => /TaskReward/.test(c.event)).map(c => [c.event, c.payload.taskId]), [['claimDailyTaskReward', 't-fm']], 'one task ready → Obtain');
  assert.deepEqual(s.snapshot().accounts.a1.rewards, { count: 1, xp: 250, at: new Date(NOW).toISOString() });
  assert.equal(mem.daily.accounts.a1.cycle, '2026-10-21T16:10:00.000Z');
  assert.equal(s.snapshot().accounts.a1.status, 'done');
  // Done for this cycle: the next Auto Play start goes straight on.
  game.calls.length = 0;
  assert.equal(await s.runIfDue(account), null);
  assert.equal(game.calls.length, 0);
});

test('only passworded matches: creates one, waits for an opponent, plays it', async () => {
  const game = fakeGame({ matches: [fm('fm-locked', { hasPassword: true })], opponentAfter: 2 });
  const { s, logs } = routine(game);
  const results = await s.runIfDue(account);
  assert.equal(results.friendly, 'played');
  assert.deepEqual(game.calls.filter(c => c.event === 'createFM').map(c => c.payload), [{ userId: USER, password: '' }]);
  assert.ok(codes(logs).includes('dr.fmCreated'));
  assert.equal(logs.find(l => l.code === 'dr.fmCreated').params.locked, 1);
});

test('everything already done today: no writes, still marked done', async () => {
  const game = fakeGame({ signInClaimed: true, signed600: true, tasksStarted: true, fmDone: true });
  const { s, logs } = routine(game);
  assert.deepEqual(await s.runIfDue(account), { signIn: 'already', signIn600: 'already', tasks: 'already', friendly: 'already' });
  assert.ok(!game.calls.some(c => ['claimSignInReward', 'startDailyTasks', 'joinFM', 'createFM'].includes(c.event)));
  assert.equal(codes(logs).at(-1), 'dr.done');
});

test('accounts that are not selected are skipped', async () => {
  const game = fakeGame();
  const { s } = routine(game, { selected: [] });
  assert.equal(await s.runIfDue(account), null);
  assert.equal(game.calls.length, 0);
});

test('a Quick Play match still running is waited out first', async () => {
  const game = fakeGame({ matches: [fm('fm-open')], otherMatch: 3 });
  const { s } = routine(game);
  assert.equal((await s.runIfDue(account)).friendly, 'played');
  const join = game.calls.findIndex(c => c.event === 'joinFM');
  assert.equal(game.calls.slice(0, join).filter(c => c.event === 'getUserActiveMatch').length, 4, '3 busy answers, then free');
});

test('nobody joins in time: our match is cancelled, the routine is left for the next start', async () => {
  const game = fakeGame({ tasksStarted: true, signInClaimed: true, signed600: true });
  let t = NOW;
  const { s, logs, mem } = routine(game, { timing: { opponentWaitMs: 5, totalMs: 12 } });
  s.now = () => (t += 1);
  const results = await s.runIfDue(account);
  assert.equal(results.friendly, 'failed');
  assert.ok(game.calls.some(c => c.event === 'cancelMatch' && c.payload.matchId === 'fm-own'));
  assert.ok(codes(logs).includes('dr.partial'));
  assert.equal(mem.daily.accounts.a1.cycle, undefined);
  assert.equal(game.state.pending, null, 'no open match left behind');
});

test('stopping Auto Play while waiting for an opponent cancels our match', async () => {
  const game = fakeGame({ tasksStarted: true, signInClaimed: true, signed600: true });
  const { s, mem } = routine(game, { timing: { pollMs: 20 } });
  const controller = new AbortController();
  const run = s.runIfDue(account, { signal: controller.signal });
  while (!game.state.pending) await new Promise(r => setTimeout(r, 5));
  controller.abort();
  await assert.rejects(run, { name: 'AbortError' });
  assert.ok(game.calls.some(c => c.event === 'cancelMatch'));
  assert.equal(mem.daily.accounts.a1, undefined);
});

test('TaskEngine runs the routine before the task loop and still runs the loop when it fails', async () => {
  const order = [];
  const plugin = { prepare: async () => ({ mode: 'socket' }), run: async () => { order.push('run'); } };
  const store = { getAccounts: () => [{ id: 'a1', name: 'Trophy6' }] };
  const make = beforeRun => new TaskEngine({
    store, credentials: {}, browserService: {}, activity: { add() {} }, onChanged() {},
    registry: { load: () => ({ plugin, manifest: { id: 't1', name: 'Quick Play' } }) }, beforeRun
  });
  const ok = make(async () => { order.push('daily'); });
  await ok.startAccount('a1', 't1');
  await ok.workers.get('a1')?.donePromise;
  const failing = make(async () => { order.push('daily-fail'); throw new Error('boom'); });
  await failing.startAccount('a1', 't1');
  await failing.workers.get('a1')?.donePromise;
  assert.deepEqual(order, ['daily', 'run', 'daily-fail', 'run']);
});

test('next run time: 19:12 TR, retry 30 min after a failure, nothing more once done', () => {
  const game = fakeGame();
  const { s, mem } = routine(game);
  const at = iso => { s.now = () => Date.parse(iso); };
  s.lastClaimCheck.set('a1', Date.parse('2030-01-01T00:00:00Z')); // reward checks are tested separately
  at('2026-10-21T15:00:00Z'); // 18:00 TR, yesterday's cycle not done yet → now
  assert.equal(s.nextDueAt('a1'), Date.parse('2026-10-21T15:00:00Z'));
  mem.daily.accounts.a1 = { cycle: '2026-10-20T16:10:00.000Z' }; // done → today's 19:12, rechecked within the hour
  assert.equal(s.nextDueAt('a1'), Date.parse('2026-10-21T16:00:00Z'));
  at('2026-10-21T16:05:00Z'); // 19:05 TR
  assert.equal(s.nextDueAt('a1'), Date.parse('2026-10-21T16:12:00Z'));
  at('2026-10-21T16:30:00Z'); // 19:30 TR, not done yet → now
  assert.equal(s.nextDueAt('a1'), Date.parse('2026-10-21T16:30:00Z'));
  mem.daily.accounts.a1 = { failedCycle: '2026-10-21T16:10:00.000Z', failedAt: '2026-10-21T16:20:00.000Z' };
  assert.equal(s.nextDueAt('a1'), Date.parse('2026-10-21T16:50:00Z'));
  mem.daily.accounts.a1 = { cycle: '2026-10-21T16:10:00.000Z' };
  assert.equal(s.nextDueAt('a1'), Date.parse('2026-10-21T17:30:00Z'), 'done → only the hourly recheck');
});

test('while Auto Play runs, the routine at its due time pauses the task loop until it ends', async () => {
  const order = [];
  let stop;
  const plugin = {
    prepare: async () => ({}),
    run: async ctx => { stop = ctx; for (;;) { order.push('action'); await ctx.sleep(20); } }
  };
  let calls = 0;
  const engine = new TaskEngine({
    store: { getAccounts: () => [{ id: 'a1', name: 'Trophy6' }] }, credentials: {}, browserService: {}, activity: { add() {} }, onChanged() {},
    registry: { load: () => ({ plugin, manifest: { id: 't1', name: 'Quick Play' } }) },
    beforeRun: async () => {
      if (calls++ === 0) return; // start: nothing due
      order.push('daily-start'); await new Promise(r => setTimeout(r, 150)); order.push('daily-end');
    },
    beforeRunNextAt: () => Date.now() // → engine's 1 s minimum
  });
  await engine.startAccount('a1', 't1');
  while (!order.includes('daily-end')) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 60));
  await engine.stopAccount('a1', { quiet: true });
  const s = order.indexOf('daily-start'), e = order.indexOf('daily-end');
  assert.ok(s > 0, 'actions ran before the routine');
  assert.ok(order.slice(s + 1, e).every(x => x !== 'action'), 'no action during the routine');
  assert.ok(order.slice(e + 1).includes('action'), 'the loop continued after it');
});

test('a selection that was never saved means every account', () => {
  const s = new DailyRoutineService({
    store: { getSettings: () => ({}), getAccounts: () => [{ id: 'a1' }, { id: 'a2' }], getDailyRoutine: () => ({ accounts: {} }) },
    activity: { add() {} }, sessions: {}, now: () => NOW
  });
  assert.deepEqual(s.selectedIds(), ['a1', 'a2']);
  assert.deepEqual(Object.keys(s.snapshot().accounts), ['a1', 'a2']);
});

test('a joined match that shows up late is still waited for, not taken as ended', async () => {
  const game = fakeGame({ signInClaimed: true, signed600: true, tasksStarted: true, matches: [fm('fm-open')], hiddenPolls: 4 });
  const { s, logs } = routine(game);
  assert.equal((await s.runIfDue(account)).friendly, 'played');
  assert.ok(codes(logs).includes('dr.fmDone'));
});

test('an FM already being played (retry) is waited for, not joined again', async () => {
  const game = fakeGame({ signInClaimed: true, signed600: true, tasksStarted: true, matches: [fm('fm-open')] });
  game.state.active = { match_id: 'fm-running', type: 'FM', hostName: 'Rival' }; game.state.activeLeft = 2;
  const { s } = routine(game);
  assert.equal((await s.runIfDue(account)).friendly, 'played');
  assert.ok(!game.calls.some(c => c.event === 'joinFM' || c.event === 'createFM'));
});

test('task rewards: Claim All for several, nothing sent when none are ready, cooldown retried', async () => {
  const game = fakeGame({ signInClaimed: true, signed600: true, tasksStarted: true, fmDone: true, pkDone: true, claimCooldownOnce: true });
  const { s, logs } = routine(game);
  const res = await s.claimRewards(['a1']);
  assert.deepEqual(res.a1, { count: 2, xp: 500, items: '10 Rare Fabric' });
  assert.equal(game.calls.filter(c => c.event === 'claimAllDailyTaskRewards').length, 2, 'cooldown answer retried once');
  assert.ok(codes(logs).includes('dr.rewardsClaimed'));
  game.calls.length = 0;
  assert.deepEqual((await s.claimRewards(['a1'])).a1, { count: 0 });
  assert.ok(!game.calls.some(c => /TaskReward/.test(c.event)), 'nothing ready → no claim call');
});

test('while Auto Play runs, a done routine still claims rewards every 30 minutes', async () => {
  const game = fakeGame({ signInClaimed: true, signed600: true, tasksStarted: true, fmDone: true });
  let t = NOW;
  const { s, mem } = routine(game);
  s.now = () => t;
  mem.daily.accounts.a1 = { cycle: '2026-10-21T16:10:00.000Z' };
  assert.equal(s.nextDueAt('a1'), t, 'never checked → now');
  await s.runIfDue(account);
  assert.equal(game.calls.filter(c => c.event === 'claimDailyTaskReward').length, 1);
  assert.equal(s.nextDueAt('a1'), t + 30 * 60 * 1000);
  t += 10 * 60 * 1000; game.calls.length = 0;
  await s.runIfDue(account);
  assert.equal(game.calls.length, 0, 'not again within 30 minutes');
});

test('Mail rewards are claimed with the task rewards and summed up by item', async () => {
  const game = fakeGame({ tasksStarted: true, pkDone: true, mails: [
    { id: 'm1', isClaimed: false, items: [{ item: { name: 'Gift Box' }, quantity: 2 }] },
    { id: 'm2', isClaimed: false, items: [{ name: 'Gift Box', quantity: 1 }, { itemName: 'Energy Drink', amount: 3 }] },
    { id: 'm3', isClaimed: true, items: [{ name: 'Old', quantity: 1 }] },
    { id: 'm4', isClaimed: false, items: [] }
  ] });
  const { s, logs } = routine(game);
  await s.claimRewards(['a1']);
  assert.equal(game.calls.filter(c => c.event === 'claimAllMailItems').length, 1);
  const log = logs.find(l => l.code === 'ml.claimed');
  assert.deepEqual(log.params, { count: 2, items: '3 Gift Box, 3 Energy Drink' });
  await s.claimRewards(['a1']);
  assert.equal(game.calls.filter(c => c.event === 'claimAllMailItems').length, 1, 'nothing left to claim, no second claim');
});
