const fs = require('fs');
const path = require('path');
const { GameSocket } = require('./game-socket.cjs');

// Daily Quiz (Office) on /socket/ (read from the game client 2026-10-23):
//   quiz:canPlay {userId} (ack) -> {success, canPlay}
//   quiz:start {userId} (ack)   -> {success, ...}
//   quiz:getCurrent {userId} (ack) -> {success, hasSession, completed, claimed, score,
//       currentQuestion {question, optionA..optionD}, questionNumber (1..10), questionDeadline (ms), timeRemaining}
//   quiz:submitAnswer {userId, answer: 'A'..'D'} (ack) -> {success, isCorrect, correctAnswer ('A'..'D'),
//       nextQuestion, questionDeadline, completed, score}
//   quiz:claimRewards {userId} (ack) -> {success}
// 10 questions a day from a pool, ~10 s each. The correct answer is shown after
// answering (even a wrong one): the app learns it. Known questions are answered
// by the app; an unknown one goes to the user, and after USER_WAIT_MS a random
// answer is tried. The bank = bundled answers (src/main/assets/quiz-bank.json, shipped
// with the setup) + answers learned here (quiz-bank.json in the user data); a learned
// answer overrides a bundled one, so a changed answer is relearned by itself.
const LETTERS = ['A', 'B', 'C', 'D'];
const QUESTIONS = 10;
const USER_WAIT_MS = 8500;
const AUTO_DELAY_MS = 900;        // a known answer is sent after a short pause
const DEADLINE_MARGIN_MS = 1200;  // never wait past the game's deadline
const BUNDLED_BANK = path.join(__dirname, '..', 'assets', 'quiz-bank.json');

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

const norm = v => String(v || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
const optionsOf = q => Object.fromEntries(LETTERS.map(l => [l, String(q?.[`option${l}`] ?? q?.options?.[l] ?? '')]));
// A question is identified by its text (the option order could change between days).
const keyOf = q => norm(q?.question);

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

class QuizService {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now(), timing = {}, bundledFile = BUNDLED_BANK, random = Math.random }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, now, bundledFile, random });
    this.onChanged = onChanged || (() => {});
    this.timing = { userWaitMs: USER_WAIT_MS, autoDelayMs: AUTO_DELAY_MS, marginMs: DEADLINE_MARGIN_MS, ...timing };
    this.run = null;
    this.controller = null;
    this.waiters = new Map();   // accountId -> resolve(letter) for a question shown to the user
  }

  // ---- answer bank ----
  _bundled() { return (readJson(this.bundledFile)?.questions) || {}; }
  _learned() { return this.store.getQuizBank?.()?.questions || {}; }
  bank() { return { ...this._bundled(), ...this._learned() }; }
  bankSize() { return Object.keys(this.bank()).length; }

  // Known answer as a letter in today's option order (matched by the answer text).
  answerFor(q) {
    const entry = this.bank()[keyOf(q)];
    if (!entry) return null;
    const opts = optionsOf(q);
    const byText = LETTERS.find(l => norm(opts[l]) && norm(opts[l]) === norm(entry.answerText));
    return byText || null;
  }

  learn(q, letter) {
    const key = keyOf(q);
    const opts = optionsOf(q);
    if (!key || !LETTERS.includes(letter) || !opts[letter]) return false;
    const data = this.store.getQuizBank?.() || { version: 1, questions: {} };
    const old = data.questions[key] || this._bundled()[key];
    const changed = !old || norm(old.answerText) !== norm(opts[letter]);
    data.questions[key] = { question: q.question, options: opts, answerText: opts[letter], learnedAt: new Date(this.now()).toISOString(), seen: (old?.seen || 0) + 1 };
    this.store.saveQuizBank?.(data);
    return changed ? (old ? 'changed' : 'new') : false;
  }

  snapshot() {
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, bankSize: this.bankSize(), lastReport: this.store.getQuizReport?.() || null };
  }

  _name(id) { return this.store.getAccounts().find(a => a.id === id)?.name || id; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'Daily Quiz', code, params, message });
  }
  _row(id, patch) { Object.assign(this.run.accounts[id], patch); this.onChanged(); }

  stop() { this.controller?.abort(); }

  // The user's answer for the question shown on that account's card.
  answer(accountId, letter) {
    const resolve = this.waiters.get(accountId);
    if (!resolve || !LETTERS.includes(letter)) return false;
    resolve({ letter, by: 'user' });
    return true;
  }

  async runAndWait(accountIds, { signal, source = 'manual' } = {}) {
    if (this.controller) throw new Error('Daily Quiz is already running.');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.controller = controller;
    const ids = accountIds.filter(id => this.store.getAccounts().some(a => a.id === id));
    this.run = { startedAt: new Date(this.now()).toISOString(), source, accounts: {} };
    for (const id of ids) this.run.accounts[id] = { accountId: id, name: this._name(id), status: 'queued', number: 0, score: null, correct: 0, auto: 0, byUser: 0, random: 0, learned: 0, question: null, deadline: null, waitUntil: null, last: null, history: [], reason: null };
    this._log(null, 'info', 'qz.start', { count: ids.length, bank: this.bankSize() }, `Daily Quiz started · ${ids.length} account(s) · ${this.bankSize()} known question(s)`);
    this.onChanged();
    try {
      await Promise.all(ids.map(id => this._account(id, controller.signal)));
    } finally {
      signal?.removeEventListener('abort', onAbort);
      for (const resolve of this.waiters.values()) resolve(null);
      this.waiters.clear();
      const rows = Object.values(this.run.accounts).map(({ question, ...r }) => ({ ...r, status: ['done', 'already', 'error'].includes(r.status) ? r.status : 'stopped' }));
      const report = { startedAt: this.run.startedAt, finishedAt: new Date(this.now()).toISOString(), source, rows };
      this.store.saveQuizReport?.(report);
      const done = rows.filter(r => r.status === 'done' || r.status === 'already').length;
      this._log(null, done === rows.length ? 'success' : 'warning', 'qz.summary', { done, total: rows.length, bank: this.bankSize() }, `Daily Quiz result · ${done}/${rows.length} account(s) finished · ${this.bankSize()} known question(s)`);
      this.controller = null;
      this.run = null;
      this.onChanged();
    }
    if (signal?.aborted) throw abortError();
    return this.snapshot();
  }

  async _ack(conn, event, payload, signal) {
    return conn.ack(event, payload, { signal, timeoutMs: 15000 });
  }

  // Writes may need `register` like other writes: try with the cookie, register once on an auth error.
  async _write(conn, state, event, payload, signal) {
    let r = await this._ack(conn, event, payload, signal);
    if (!r?.success && /auth|login|register/i.test(String(r?.error || r?.message || '')) && !state.registered) {
      await conn.register(payload.userId, { signal });
      state.registered = true;
      r = await this._ack(conn, event, payload, signal);
    }
    return r;
  }

  // Waits for the user's choice (or a learned answer from another account) up to the limit.
  _choose(id, q, deadline, signal) {
    const limit = Math.min(this.now() + this.timing.userWaitMs, (deadline || Infinity) - this.timing.marginMs);
    const waitMs = Math.max(0, limit - this.now());
    this._row(id, { status: 'askUser', waitUntil: new Date(this.now() + waitMs).toISOString() });
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; clearTimeout(timer); clearInterval(poll); this.waiters.delete(id); signal?.removeEventListener('abort', onAbort); resolve(v); };
      const timer = setTimeout(() => finish({ letter: LETTERS[Math.floor(this.random() * 4)], by: 'random' }), waitMs);
      // The same question may be answered on another account meanwhile.
      const poll = setInterval(() => { const l = this.answerFor(q); if (l) finish({ letter: l, by: 'auto' }); }, 300);
      const onAbort = () => finish(null);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.set(id, finish);
    });
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    let conn = null;
    try {
      if (this.gameHealth?.isDown()) { this._row(id, { status: 'waitingGame' }); await this.gameHealth.waitUp(signal); }
      this._row(id, { status: 'login' });
      const session = await this.sessions.get(account, { owner: 'quiz' });
      const userId = session.userId;
      conn = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
      const state = { registered: false };
      let cur = await this._ack(conn, 'quiz:getCurrent', { userId }, signal);
      if (!(cur?.hasSession)) {
        const can = await this._ack(conn, 'quiz:canPlay', { userId }, signal);
        if (can?.success && can.canPlay === false) { this._row(id, { status: 'already', reason: 'already' }); this._log(id, 'info', 'qz.already', {}, 'Daily Quiz already played today'); return; }
        const st = await this._write(conn, state, 'quiz:start', { userId }, signal);
        if (!st?.success) throw new Error(st?.error || st?.message || 'The quiz could not be started.');
        cur = await this._ack(conn, 'quiz:getCurrent', { userId }, signal);
      }
      let q = cur?.currentQuestion || null;
      let number = Number(cur?.questionNumber) || 1;
      let deadline = Number(cur?.questionDeadline) || null;
      let completed = Boolean(cur?.completed);
      let score = cur?.score ?? null;
      while (!completed && q) {
        if (signal.aborted) throw abortError();
        const known = this.answerFor(q);
        this._row(id, { status: known ? 'answering' : 'askUser', number, question: { text: q.question, options: optionsOf(q), known: Boolean(known) }, deadline: deadline ? new Date(deadline).toISOString() : null });
        let pick;
        if (known) {
          await new Promise(r => setTimeout(r, this.timing.autoDelayMs));
          pick = { letter: known, by: 'auto' };
        } else {
          pick = await this._choose(id, q, deadline, signal);
          if (!pick) throw abortError();
        }
        this._row(id, { status: 'answering', waitUntil: null });
        const r = await this._write(conn, state, 'quiz:submitAnswer', { userId, answer: pick.letter }, signal);
        if (!r?.success) {
          // Usually the time ran out: read where the quiz is now and go on.
          const now = await this._ack(conn, 'quiz:getCurrent', { userId }, signal);
          this._log(id, 'warning', 'qz.answerFailed', { n: number, error: r?.error || r?.message || '?' }, `Question ${number}: answer not accepted (${r?.error || r?.message || '?'})`);
          q = now?.currentQuestion || null; number = Number(now?.questionNumber) || number + 1; deadline = Number(now?.questionDeadline) || null;
          completed = Boolean(now?.completed); score = now?.score ?? score;
          continue;
        }
        const correct = LETTERS.includes(r.correctAnswer) ? r.correctAnswer : (r.isCorrect ? pick.letter : null);
        const learned = correct ? this.learn(q, correct) : false;
        if (learned === 'changed') this._log(id, 'warning', 'qz.relearned', { n: number }, `Question ${number}: the answer had changed · relearned`);
        const row = this.run.accounts[id];
        const entry = { n: number, question: q.question, picked: pick.letter, pickedText: optionsOf(q)[pick.letter], correct, correctText: correct ? optionsOf(q)[correct] : '', ok: Boolean(r.isCorrect), by: pick.by };
        this._row(id, {
          correct: row.correct + (r.isCorrect ? 1 : 0), auto: row.auto + (pick.by === 'auto' ? 1 : 0), byUser: row.byUser + (pick.by === 'user' ? 1 : 0), random: row.random + (pick.by === 'random' ? 1 : 0),
          learned: row.learned + (learned ? 1 : 0), last: entry, history: [...row.history, entry]
        });
        completed = Boolean(r.completed);
        score = r.score ?? score;
        q = r.nextQuestion || null;
        number += 1;
        deadline = Number(r.questionDeadline) || (q ? this.now() + 10000 : null);
      }
      this._row(id, { status: 'claiming', question: null, score });
      const claim = await this._write(conn, state, 'quiz:claimRewards', { userId }, signal);
      const claimed = Boolean(claim?.success) || /already/i.test(String(claim?.error || claim?.message || ''));
      const row = this.run.accounts[id];
      this._row(id, { status: 'done', score: score ?? row.correct, claimed });
      this._log(id, claimed ? 'success' : 'warning', claimed ? 'qz.done' : 'qz.claimFailed',
        { score: score ?? row.correct, total: QUESTIONS, learned: row.learned, error: claim?.error || claim?.message || '' },
        claimed ? `Daily Quiz finished · ${score ?? row.correct}/${QUESTIONS} · rewards claimed · ${row.learned} new answer(s) learned` : `Daily Quiz finished but rewards were not claimed: ${claim?.error || claim?.message || '?'}`);
    } catch (error) {
      if (error?.name === 'AbortError') { this._row(id, { status: 'stopped', question: null }); return; }
      if (/auth|session|login/i.test(error.message)) this.sessions.invalidate?.(id);
      this._row(id, { status: 'error', reason: error.message, question: null });
      this._log(id, 'error', 'qz.failed', { error: error.message }, `Daily Quiz stopped: ${error.message}`);
    } finally {
      this.waiters.delete(id);
      try { conn?.close(); } catch {}
    }
  }
}

module.exports = { QuizService, keyOf, optionsOf, LETTERS };
