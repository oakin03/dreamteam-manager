const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { GoUpService, pointsOf } = require('../src/main/services/goup-service.cjs');
const { QuizService, keyOf } = require('../src/main/services/quiz-service.cjs');
const { CheerService, cheerDay, nextReset } = require('../src/main/services/cheer-service.cjs');
const { ChatService, normalizeConfig } = require('../src/main/services/chat-service.cjs');

// A fake socket.io client: `acks(path, event, payload, args)` answers acks,
// `events(path, event, payload, emitLocal)` answers plain emits.
function fakeSockets({ acks = () => undefined, events = () => {} }) {
  const calls = [];
  const createSocket = (_url, options) => {
    const s = new EventEmitter();
    s.off = s.removeListener;
    s.connected = true;
    s.close = () => { s.closed = true; s.connected = false; };
    const emitLocal = EventEmitter.prototype.emit.bind(s);
    const p = options.path;
    s.emit = (event, ...args) => {
      calls.push({ path: p, event, args, cookie: Boolean(options.extraHeaders) });
      events(p, event, args[0], (n, d) => setTimeout(() => !s.closed && emitLocal(n, d), 1));
      return true;
    };
    s.timeout = () => ({ emit: (event, ...args) => {
      const cb = args.pop();
      calls.push({ path: p, event, args, cookie: Boolean(options.extraHeaders) });
      const d = acks(p, event, args[0], args);
      setTimeout(() => cb(null, d), 1);
    } });
    setTimeout(() => emitLocal('connect'), 1);
    return s;
  };
  return { createSocket, calls };
}

const accounts = [{ id: 'a', name: 'Main' }, { id: 'b', name: 'Side' }];
function store(extra = {}) {
  const saved = {};
  return {
    saved,
    getAccounts: () => accounts,
    getAccountProfile: () => ({ mainAccountId: 'a', accounts: { a: { userId: 'u-a' }, b: { userId: 'u-b' } } }),
    getSettings: () => ({}),
    saveGoUpReport: v => { saved.goup = v; }, saveQuizReport: v => { saved.quiz = v; }, saveCheerReport: v => { saved.cheer = JSON.parse(JSON.stringify(v)); }, getCheerReport: () => saved.cheer || null, saveChatReport: v => { saved.chat = v; },
    getQuizBank: () => saved.bank || null, saveQuizBank: v => { saved.bank = JSON.parse(JSON.stringify(v)); },
    ...extra
  };
}
const sessions = { get: async account => ({ userId: `u-${account.id}`, cookieHeader: 'c=1' }) };
const activity = logs => ({ add: e => logs.push(e) });

test('Go-up points: season = goUpValue, total = goUpPoints', () => {
  const p = pointsOf({ goUpValue: 1000, goUpPoints: 1300, currentTier: { name: 'Senior', level: 3 }, attemptsRemaining: 1, maxAttempts: 2, isEventActive: true });
  assert.deepEqual([p.season, p.total, p.tier.name, p.tier.level, p.left, p.max, p.active], [1000, 1300, 'Senior', 3, 1, 2, true]);
});

test('Go-up plays until attempts run out: queue → started → ended, points refreshed', async () => {
  const st = { left: 2, season: 1000, total: 1300, match: null, phase: 0 };
  const { createSocket, calls } = fakeSockets({ acks: (p, event) => {
    if (event === 'getGoUpData') return { success: true, data: { goUpValue: st.season, goUpPoints: st.total, attemptsRemaining: st.left, maxAttempts: 2, isEventActive: true, currentTier: { name: 'Senior', level: 3 } } };
    if (event === 'getUserActiveMatch') return { success: true, match: null };
    if (event === 'findGoUpMatch') { st.left--; st.phase = 0; st.match = { match_id: 'g1', status: 'waiting', host: 'u-a' }; return { success: true, matchId: 'g1', server: 1 }; }
    if (event === 'getGoUpMatches') {
      if (!st.match) return { success: true, userMatch: null };
      st.phase++;
      if (st.phase === 2) st.match = { ...st.match, status: 'started', opponentName: 'Rival' };
      if (st.phase === 4) { st.match = null; st.season += 20; st.total += 20; }
      return { success: true, userMatch: st.match };
    }
  } });
  const logs = [];
  const s = store();
  const svc = new GoUpService({ store: s, activity: activity(logs), sessions, createSocket, timing: { pollMs: 1, appearGraceMs: 50 } });
  await svc.runAndWait(['a']);
  const row = s.saved.goup.rows[0];
  assert.equal(row.status, 'done');
  assert.equal(row.played, 2);
  assert.equal(row.season, 1040);
  assert.equal(row.total, 1340);
  assert.equal(calls.filter(c => c.event === 'findGoUpMatch').length, 2);
  assert.ok(calls.filter(c => c.event === 'findGoUpMatch').every(c => c.path === '/simulation-socket/' && c.cookie));
  assert.ok(logs.some(l => l.code === 'gu.matchStarted') && logs.some(l => l.code === 'gu.matchDone'));
});

test('Go-up stops with a warning when the event is closed', async () => {
  const { createSocket, calls } = fakeSockets({ acks: (p, event) => event === 'getGoUpData' ? { success: true, data: { goUpValue: 1, goUpPoints: 1, attemptsRemaining: 2, isEventActive: false, eventTimeInfo: 'Season break' } } : { success: true, match: null } });
  const logs = [];
  const s = store();
  await new GoUpService({ store: s, activity: activity(logs), sessions, createSocket, timing: { pollMs: 1 } }).runAndWait(['a']);
  assert.equal(s.saved.goup.rows[0].status, 'inactive');
  assert.ok(!calls.some(c => c.event === 'findGoUpMatch'));
  assert.ok(logs.some(l => l.code === 'gu.inactive' && l.level === 'warning'));
});

test('Go-up staggered start waits the gap between accounts', async () => {
  const { createSocket } = fakeSockets({ acks: (p, event) => event === 'getGoUpData' ? { success: true, data: { attemptsRemaining: 0, isEventActive: true } } : { success: true, match: null } });
  const s = store();
  const svc = new GoUpService({ store: s, activity: activity([]), sessions, createSocket, timing: { pollMs: 1 } });
  const t0 = Date.now();
  await svc.runAndWait(['a', 'b'], { mode: 'staggered', gapSec: 0.15 });
  assert.ok(Date.now() - t0 >= 140);
  assert.deepEqual(s.saved.goup.rows.map(r => r.status), ['noAttempts', 'noAttempts']);
});

function quizGame(questions, correct) {
  const st = { i: 0, started: false, claimed: false, answers: [] };
  const q = i => questions[i];
  return { st, ...fakeSockets({ acks: (p, event, payload) => {
    if (event === 'quiz:getCurrent') return st.started ? { success: true, hasSession: true, completed: st.i >= questions.length, currentQuestion: q(st.i), questionNumber: st.i + 1, questionDeadline: Date.now() + 10000 } : { success: true, hasSession: false };
    if (event === 'quiz:canPlay') return { success: true, canPlay: true };
    if (event === 'quiz:start') { st.started = true; return { success: true }; }
    if (event === 'quiz:submitAnswer') {
      const right = correct[st.i];
      st.answers.push(payload.answer);
      st.i++;
      const completed = st.i >= questions.length;
      return { success: true, isCorrect: payload.answer === right, correctAnswer: right, completed, score: completed ? st.answers.filter((a, k) => a === correct[k]).length : undefined, nextQuestion: completed ? null : q(st.i), questionDeadline: Date.now() + 10000 };
    }
    if (event === 'quiz:claimRewards') { st.claimed = true; return { success: true }; }
  } }) };
}
const Q = (question, a, b, c, d) => ({ question, optionA: a, optionB: b, optionC: c, optionD: d });

test('Daily Quiz: known answers by text, unknown → user, then random; learns the correct answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qz-'));
  const bundledFile = path.join(dir, 'bank.json');
  // Bundled bank knows Q1 (answer text "Paris"); options come in another order today.
  fs.writeFileSync(bundledFile, JSON.stringify({ questions: { [keyOf({ question: 'Capital of France?' })]: { question: 'Capital of France?', answerText: 'Paris' } } }));
  const questions = [Q('Capital of France?', 'Rome', 'Paris', 'Oslo', 'Bern'), Q('2+2?', '3', '4', '5', '6'), Q('Sky color?', 'Green', 'Red', 'Blue', 'Pink')];
  const game = quizGame(questions, ['B', 'B', 'C']);
  const s = store();
  const svc = new QuizService({ store: s, activity: activity([]), sessions, createSocket: game.createSocket, bundledFile, random: () => 0, timing: { userWaitMs: 80, autoDelayMs: 1, marginMs: 0 } });
  // The user answers question 2 (wrongly, "A"); question 3 times out → random "A".
  const answered = new Promise(resolve => {
    const t = setInterval(() => { const r = svc.run?.accounts?.a; if (r?.status === 'askUser' && r.number === 2) { svc.answer('a', 'A'); clearInterval(t); resolve(); } }, 5);
  });
  await svc.runAndWait(['a']);
  await answered;
  assert.deepEqual(game.st.answers, ['B', 'A', 'A']);
  assert.equal(game.st.claimed, true);
  const row = s.saved.quiz.rows[0];
  assert.equal(row.status, 'done');
  assert.deepEqual([row.auto, row.byUser, row.random, row.correct], [1, 1, 1, 1]);
  // Learned the right answers (not the user's), by text.
  const bank = svc.bank();
  assert.equal(bank[keyOf({ question: '2+2?' })].answerText, '4');
  assert.equal(bank[keyOf({ question: 'Sky color?' })].answerText, 'Blue');
  assert.equal(svc.answerFor(Q('2+2?', '4', '3', '5', '6')), 'A');
});

test('Daily Quiz relearns a question whose answer changed', () => {
  const s = store();
  const svc = new QuizService({ store: s, activity: activity([]), sessions, bundledFile: path.join(os.tmpdir(), 'none.json') });
  const q = Q('Best team?', 'X', 'Y', 'Z', 'W');
  assert.equal(svc.learn(q, 'A'), 'new');
  assert.equal(svc.learn(q, 'A'), false);
  assert.equal(svc.learn(q, 'C'), 'changed');
  assert.equal(svc.answerFor(q), 'C');
});

test('Cheer: no match → nothing sent, "noMatch" reported', async () => {
  const { createSocket, calls } = fakeSockets({ acks: (p, event) => event === 'getUserActiveMatch' ? { success: true, match: null } : undefined });
  const s = store();
  const r = await new CheerService({ store: s, activity: activity([]), sessions, createSocket }).cheer(['b'], 'a');
  assert.equal(r.error, 'noMatch');
  assert.ok(!calls.some(c => c.event === 'useCheer'));
});

test('Cheer: sides cheer for the target team on the match server, free cheer only', async () => {
  const { createSocket, calls } = fakeSockets({ acks: (p, event, payload, args) => {
    if (event === 'getUserActiveMatch') return { success: true, match: { match_id: 'm9', host: 'u-x', opponent: 'u-a', Server: 2, type: 'PK' } };
    if (event === 'useCheer') return args[0] === 'm9' ? { success: true, message: 'ok' } : { success: false };
  } });
  const logs = [];
  const r = await new CheerService({ store: store(), activity: activity(logs), sessions, createSocket }).cheer(['b'], 'a');
  assert.equal(r.side, 'opponent');
  assert.deepEqual(r.rows.map(x => x.ok), [true]);
  const cheer = calls.find(c => c.event === 'useCheer');
  assert.equal(cheer.path, '/simulation-server-2-socket/');
  assert.deepEqual(cheer.args, ['m9', 'opponent']);
  assert.ok(calls.some(c => c.event === 'joinMatchRoom'));
  assert.ok(!calls.some(c => c.event === 'useCheerProps'));
});

test('Chat config: interval ≥ 11 s, text ≤ 50, rows need an account; default 20 loops', () => {
  const c = normalizeConfig({ messages: [{ text: 'x'.repeat(80), accountId: 'a' }, { text: '  ', accountId: 'a' }, { text: 'hi', accountId: null }], intervalSec: 3 });
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].text.length, 50);
  assert.equal(c.intervalSec, 11);
  assert.equal(c.loops, 20);
  assert.equal(c.infinite, false);
});

test('Chat writes the list in order with each message\'s account, loops, skips blocked accounts', async () => {
  const sent = [];
  const { createSocket } = fakeSockets({
    acks: () => undefined,
    events: (p, event, payload, reply) => {
      if (event === 'getUserBasicInfo') reply('userBasicInfo', { teamName: 'T', level: 10, activeTitle: 'Rookie', activeTitleColor: '#fff' });
      if (event === 'sendMessage') {
        sent.push(`${payload.userId}:${payload.text}`);
        if (payload.userId === 'u-b') reply('chatBlocked', { message: 'spam' });
        else reply('newMessage', { userId: payload.userId, text: payload.text, type: 'all' });
      }
    }
  });
  const logs = [];
  const s = store();
  const svc = new ChatService({ store: s, activity: activity(logs), sessions, createSocket, timing: { secondMs: 1, confirmMs: 50 } });
  await svc.runAndWait({ messages: [{ text: 'one', accountId: 'a' }, { text: 'two', accountId: 'b' }, { text: 'three', accountId: 'a' }], intervalSec: 11, loops: 2 });
  assert.deepEqual(sent, ['u-a:one', 'u-b:two', 'u-a:three', 'u-a:one', 'u-a:three']);
  assert.equal(s.saved.chat.sent, 4);
  assert.deepEqual(Object.keys(s.saved.chat.blocked), ['b']);
  assert.ok(logs.some(l => l.code === 'cs.blocked'));
});

test('Cheer day starts at 19:10 TR; the next reset is the coming 19:10', () => {
  // 2026-10-23 16:09 UTC = 19:09 TR → still the 22nd's cheer day; 16:10 UTC = 19:10 TR → the 23rd.
  assert.equal(cheerDay(Date.parse('2026-10-23T16:09:00Z')), '2026-10-22');
  assert.equal(cheerDay(Date.parse('2026-10-23T16:10:00Z')), '2026-10-23');
  assert.equal(new Date(nextReset(Date.parse('2026-10-23T12:00:00Z'))).toISOString(), '2026-10-23T16:10:00.000Z');
  assert.equal(new Date(nextReset(Date.parse('2026-10-23T17:00:00Z'))).toISOString(), '2026-10-24T16:10:00.000Z');
});

test('Cheer counts 3 a day per account, a limit reply sets 0, and the book resets at 19:10', async () => {
  let refuse = false;
  const { createSocket } = fakeSockets({ acks: (p, event) => {
    if (event === 'getUserActiveMatch') return { success: true, match: { match_id: 'm1', host: 'u-a', Server: 1 } };
    if (event === 'useCheer') return refuse ? { success: false, message: 'Daily cheer limit reached' } : { success: true };
  } });
  let now = Date.parse('2026-10-23T10:00:00Z');
  const s = store();
  const svc = new CheerService({ store: s, activity: activity([]), sessions, createSocket, now: () => now });
  for (let i = 0; i < 3; i++) await svc.cheer(['b'], 'a');
  assert.equal(svc.snapshot().left.b, 0);
  const fourth = await svc.cheer(['b'], 'a');
  assert.equal(fourth.rows[0].message, 'noCheersLeft');
  assert.equal(svc.snapshot().entries.length, 4);
  // After 19:10 TR everything is fresh; a limit reply marks the account as used up.
  now = Date.parse('2026-10-23T16:11:00Z');
  assert.equal(svc.snapshot().left.b, 3);
  assert.equal(svc.snapshot().entries.length, 0);
  refuse = true;
  await svc.cheer(['b'], 'a');
  assert.equal(svc.snapshot().left.b, 0);
  svc.stop();
});
