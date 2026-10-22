const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { TournamentService, planAccount, normalizeEvent } = require('../src/main/services/tournament-service.cjs');

const ME = 'user-me';
function ev(id, { type = 'APK_MATCH', status = 'REGISTRATION', min = 20, max = 39, count = 0, users = [] } = {}) {
  return { id, name: `${type} ${min}-${max}`, type, status, minLevel: min, maxLevel: max, maxPlayers: 128,
    startsAt: '2026-10-21T12:00:00.000Z', _count: { registrations: count || users.length }, registrations: users.map(userId => ({ userId })) };
}

// Fake game: `script` returns the event list for the n-th getActiveMultiplayerEvents call.
function fakeGame(script, { level = 30, registerReply = () => ({ success: true }) } = {}) {
  const emitted = [];
  let reads = 0;
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.connected = false;
    s.close = () => { s.closed = true; };
    s.off = s.removeListener;
    const emit = EventEmitter.prototype.emit.bind(s);
    const handle = (event, payload, ack) => {
      emitted.push({ path: options.path, event, payload, cookie: options.extraHeaders?.Cookie || null });
      if (event === 'getActiveMultiplayerEvents') ack(null, script(reads++));
      else if (event === 'MultiRegistrationJoinRoom') ack(null, true);
      else if (event === 'registerMultiplayer') ack(null, registerReply(payload));
      else if (event === 'getMatchUserData') setTimeout(() => emit('matchUserData', { success: true, level }), 1);
    };
    s.timeout = () => ({ emit: (event, ...args) => { const ack = args.pop(); setTimeout(() => handle(event, args[0], ack), 1); } });
    s.emit = (event, payload) => { setTimeout(() => handle(event, payload, () => {}), 1); return true; };
    setTimeout(() => { s.connected = true; emit('connect'); }, 1);
    return s;
  };
  return { createSocket, emitted, reads: () => reads };
}

function service(game) {
  const logs = [];
  const merges = [];
  const accounts = [{ id: 'a1', name: 'Acc', login: 'l', passwordEncrypted: 'x' }];
  const s = new TournamentService({
    store: { getAccounts: () => accounts },
    credentials: { decryptSecret: () => 'pw' },
    browserService: { authenticate: async () => ({ userId: ME, cookieHeader: 'session=abc' }) },
    accountProfile: { merge: (id, data) => merges.push([id, data]), snapshot: () => ({ accounts: {} }) },
    activity: { add: entry => logs.push(entry) },
    onChanged: () => {},
    createSocket: game.createSocket,
    pollMs: { blank: 5, ongoing: 5, idle: 5 }
  });
  return { s, logs, merges };
}

async function runToEnd(s, ids = ['a1']) {
  await s.start(ids);
  await s.run;
}

test('planAccount separates register, already registered (Quit), full and Look on', () => {
  const events = [
    ev('open', { min: 20, max: 39 }),
    ev('quit', { type: 'STAR_MATCH', users: [ME] }),
    ev('full', { type: 'TK_MATCH', count: 128 }),
    ev('look', { type: 'MATERIALS_MATCH', status: 'ONGOING' }),
    ev('other-level', { type: 'STONE_MATCH', min: 40, max: 59 })
  ].map(normalizeEvent);
  const plan = planAccount(events, { level: 30, userId: ME, knownTypes: new Set(['APK_MATCH', 'STAR_MATCH', 'TK_MATCH', 'MATERIALS_MATCH', 'EXCLUSIVE_MATCH']) });
  assert.deepEqual(plan.toRegister.map(e => e.id), ['open']);
  assert.deepEqual(plan.registered.map(e => e.id), ['quit']);
  assert.deepEqual(plan.full.map(e => e.id), ['full']);
  assert.deepEqual(plan.ongoing.map(e => e.id), ['look']);
  assert.deepEqual(plan.missingTypes, ['EXCLUSIVE_MATCH']);
  assert.equal(plan.waiting, true);
});

test('registers every open tournament for the level and never touches a joined one', async () => {
  const list = [ev('open1'), ev('open2', { type: 'STAR_MATCH' }), ev('joined', { type: 'TK_MATCH', users: [ME] }), ev('full', { type: 'STONE_MATCH', count: 128 }), ev('high', { min: 40, max: 59, type: 'X' })];
  const game = fakeGame(() => list);
  const { s, logs, merges } = service(game);
  await runToEnd(s);
  const registers = game.emitted.filter(e => e.event === 'registerMultiplayer');
  assert.deepEqual(registers.map(e => e.payload), [{ eventId: 'open1', userId: ME }, { eventId: 'open2', userId: ME }]);
  assert.ok(registers.every(e => e.cookie === 'session=abc' && e.path === '/event-socket/'));
  // Only reads, the room join and registration are ever sent — no way to quit.
  assert.deepEqual([...new Set(game.emitted.map(e => e.event))].sort(), ['MultiRegistrationJoinRoom', 'getActiveMultiplayerEvents', 'getMatchUserData', 'registerMultiplayer']);
  const state = s.snapshot().accounts.a1;
  assert.equal(state.status, 'done');
  assert.equal(state.level, 30);
  assert.deepEqual(state.joined.map(j => j.id), ['open1', 'open2']);
  assert.match(state.message, /joined .* · already registered: TK_MATCH 20-39 · 1 full/);
  assert.deepEqual(merges.find(([, d]) => d.level), ['a1', { level: 30 }]);
  assert.equal(s.runtime.status, 'done');
  assert.ok(logs.some(l => l.level === 'success' && /Registered · APK_MATCH 20-39/.test(l.message)));
});

test('waits while today\'s tournament is Look on, through the blank minute, then registers the new one', async () => {
  const others = [ev('star', { type: 'STAR_MATCH', count: 128 })];
  const game = fakeGame(n => {
    if (n < 3) return [...others, ev('today-old', { type: 'MATERIALS_MATCH', status: 'ONGOING' })];
    if (n < 5) return [...others]; // finished: the row is gone for a moment
    return [...others, ev('today-new', { type: 'MATERIALS_MATCH' })];
  });
  const { s, logs } = service(game);
  await runToEnd(s);
  const registers = game.emitted.filter(e => e.event === 'registerMultiplayer');
  assert.deepEqual(registers.map(e => e.payload.eventId), ['today-new']);
  assert.equal(s.snapshot().accounts.a1.status, 'done');
  const waits = logs.filter(l => l.message.startsWith('Waiting'));
  assert.match(waits[0].message, /MATERIALS_MATCH 20-39 is in progress \(Look on\)/);
  assert.match(waits[1].message, /MATERIALS MATCH just ended · next registration should appear/);
});

test('a refused registration is logged and not retried; a full one is reported', async () => {
  const game = fakeGame(() => [ev('excl', { type: 'EXCLUSIVE_MATCH' }), ev('apk')], {
    registerReply: p => (p.eventId === 'excl' ? { success: false, message: 'Not eligible' } : { success: false, message: 'Event is full' })
  });
  const { s, logs } = service(game);
  await runToEnd(s);
  const registers = game.emitted.filter(e => e.event === 'registerMultiplayer');
  // Each tried exactly once: the refusal is final, the full one finishes the account.
  assert.deepEqual(registers.map(e => e.payload.eventId).sort(), ['apk', 'excl']);
  assert.ok(logs.some(l => l.level === 'warning' && /Registration refused · EXCLUSIVE_MATCH 20-39 · Not eligible/.test(l.message)));
  assert.ok(logs.some(l => l.level === 'warning' && /filled up before registration/.test(l.message)));
  assert.match(s.snapshot().accounts.a1.message, /1 full/);
});

test('an account without a tournament for its level finishes with a warning', async () => {
  const game = fakeGame(() => [ev('rookie', { min: 10, max: 19 })], { level: 5 });
  const { s, logs } = service(game);
  await runToEnd(s);
  assert.equal(game.emitted.filter(e => e.event === 'registerMultiplayer').length, 0);
  assert.match(s.snapshot().accounts.a1.message, /No tournament for level 5/);
  assert.ok(logs.some(l => l.level === 'warning' && /No tournament accepts level 5/.test(l.message)));
});

test('stop() ends a waiting run and marks the account stopped', async () => {
  const game = fakeGame(() => [ev('today', { type: 'MATERIALS_MATCH', status: 'ONGOING' })]);
  const { s } = service(game);
  await s.start(['a1']);
  try {
    for (let i = 0; i < 200 && s.snapshot().accounts.a1.status !== 'waiting'; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(s.snapshot().accounts.a1.status, 'waiting');
  } finally {
    await s.stop();
  }
  assert.equal(s.runtime.status, 'stopped');
  assert.equal(s.snapshot().accounts.a1.status, 'stopped');
  assert.equal(game.emitted.filter(e => e.event === 'registerMultiplayer').length, 0);
});

test('the event list maps registered user ids back to our accounts', async () => {
  const game = fakeGame(() => [ev('quit', { users: [ME] })]);
  const { s } = service(game);
  await runToEnd(s);
  assert.deepEqual(s.snapshot().events[0].accountIds, ['a1']);
});

test('runAndWait resolves when the accounts are done (used by schedules)', async () => {
  const game = fakeGame(() => [ev('open')]);
  const { s } = service(game);
  const snap = await s.runAndWait(['a1']);
  assert.equal(snap.runtime.status, 'done');
  assert.equal(snap.accounts.a1.joined.length, 1);
});

test('runAndWait stops when the schedule is cancelled and refuses to overlap a manual run', async () => {
  const game = fakeGame(() => [ev('today', { type: 'MATERIALS_MATCH', status: 'ONGOING' })]);
  const { s } = service(game);
  const controller = new AbortController();
  const run = s.runAndWait(['a1'], { signal: controller.signal });
  await assert.rejects(s.runAndWait(['a1']), /already running/);
  setTimeout(() => controller.abort(), 50);
  const snap = await run;
  assert.equal(snap.runtime.status, 'stopped');
});

test('the run report says who registered and why the others did not, and is saved', async () => {
  // Levels by user: u1/u2/u3 fit 20-39. u2 is already in, u3's tournament fills up.
  const list = () => [ev('apk', { users: ['u2'] })];
  const emitted = [];
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.close = () => {};
    s.off = s.removeListener;
    const emit = EventEmitter.prototype.emit.bind(s);
    const handle = (event, payload, ack) => {
      emitted.push({ event, payload });
      if (event === 'getActiveMultiplayerEvents') ack(null, list());
      else if (event === 'MultiRegistrationJoinRoom') ack(null, true);
      else if (event === 'registerMultiplayer') ack(null, payload.userId === 'u3' ? { success: false, message: 'Event is full' } : { success: true });
      else if (event === 'getMatchUserData') setTimeout(() => emit('matchUserData', { success: true, level: 30 }), 1);
    };
    s.timeout = () => ({ emit: (event, ...args) => { const ack = args.pop(); setTimeout(() => handle(event, args[0], ack), 1); } });
    s.emit = (event, payload) => { setTimeout(() => handle(event, payload, () => {}), 1); return true; };
    setTimeout(() => { s.connected = true; emit('connect'); }, 1);
    return s;
  };
  const accounts = ['A1', 'A2', 'A3', 'A4'].map((name, i) => ({ id: `a${i + 1}`, name, login: name, passwordEncrypted: 'x' }));
  let saved = null;
  const logs = [];
  const s = new TournamentService({
    store: { getAccounts: () => accounts, getTournamentReport: () => null, saveTournamentReport: r => { saved = r; } },
    credentials: { decryptSecret: () => 'pw' },
    browserService: { authenticate: async account => {
      if (account.id === 'a4') throw new Error('Login screen did not appear in time.');
      return { userId: `u${account.id.slice(1)}`, cookieHeader: 'c' };
    } },
    accountProfile: { merge: () => {}, snapshot: () => ({ accounts: {} }) },
    activity: { add: e => logs.push(e) }, onChanged: () => {}, createSocket, pollMs: { blank: 5, ongoing: 5, idle: 5 }
  });
  await s.runAndWait(accounts.map(a => a.id));
  const byName = Object.fromEntries(saved.accounts.map(r => [r.name, r]));
  assert.equal(saved.source, 'schedule');
  assert.equal(byName.A1.outcome, 'registered');
  assert.deepEqual(byName.A1.joined, ['APK_MATCH 20-39']);
  assert.equal(byName.A2.outcome, 'already');
  assert.equal(byName.A3.outcome, 'full');
  // Details are language-neutral; the page adds the translated outcome label.
  assert.equal(byName.A3.reason, 'APK_MATCH 20-39');
  assert.equal(byName.A2.reason, 'APK_MATCH 20-39');
  assert.equal(byName.A4.outcome, 'error');
  assert.match(byName.A4.reason, /Login screen did not appear/);
  assert.equal(saved.registered, 1);
  assert.deepEqual(s.snapshot().lastReport, saved);
  const summary = logs.find(l => l.message.startsWith('Report ·'));
  assert.match(summary.message, /registered: A1, A2 \(already\) · not registered: A3 \(full: .*\) · A4 \(error: Login screen/);
  assert.equal(summary.code, 'tn.report');
  assert.deepEqual(summary.params.rows.map(r => r.outcome), ['registered', 'already', 'full', 'error']);
  // Every Tournament log carries a code so the page can show it in the selected language.
  assert.ok(logs.filter(l => l.taskName === 'Tournament').every(l => l.code), JSON.stringify(logs.filter(l => !l.code).map(l => l.message)));
});
