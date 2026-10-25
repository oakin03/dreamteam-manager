const { GameSocket } = require('./game-socket.cjs');
const { isNetError } = require('./game-health.cjs');

// Proving Grounds modes against bots, 2 free attempts a day each (read from the game
// client and tried live 2026-10-25):
//
// Daily Boss — /simulation-socket/ acks, reads need only the user id:
//   dailyBoss:getBosses {userId}   -> {success, userLevel, bosses:[{id, name, tier, levelRequired,
//                                      botUser{id}, progress{totalClears, totalAttempts}}]}
//   dailyBoss:getAttempts {userId} -> {success, remaining, max}
//   playDailyBossMatch {userId, bossId, opponentId: botUser.id} (cookie) -> {success, matchId, server}
//
// Elite Ascent (the game calls it "backToPeak") — 300 floors, a win moves one floor up:
//   /socket/ backToPeak:getData -> backToPeak:data {success, data:{floors[]:{floorNumber,
//            enemyUser{id}}, progress{currentFloor, highestFloor, isCompleted}}}
//   /socket/ backToPeak:getAttempts -> backToPeak:attempts {attemptsUsed, attemptsRemaining}
//            (no user id in the payload: these need a `register`ed socket)
//   /simulation-socket/ playBackToPeakMatch {userId, opponentId, floorNumber} (cookie, ack)
// Paid attempts are never bought or used.
//
// A match ends when getUserActiveMatch (/simulation-socket/) no longer returns it.
const SIM_PATH = '/simulation-socket/';
const POLL_MS = 3000;
const APPEAR_GRACE_MS = 20000;
const MATCH_MAX_MS = 15 * 60 * 1000;
const MAX_FAILURES = 3;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
const NO_ATTEMPTS = /attempt|limit|no more|remaining|already used|daily/i;

class ProvingBase {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now(), timing = {} }, { taskName, prefix, reportKey }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, now, taskName, prefix, reportKey });
    this.onChanged = onChanged || (() => {});
    this.timing = { pollMs: POLL_MS, appearGraceMs: APPEAR_GRACE_MS, matchMaxMs: MATCH_MAX_MS, ...timing };
    this.run = null;
    this.controller = null;
    this.info = {};
  }

  _name(id) { return this.store.getAccounts().find(a => a.id === id)?.name || id; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: this.taskName, code: `${this.prefix}.${code}`, params, message });
  }
  _row(id, patch) { Object.assign(this.run.accounts[id], patch); this.onChanged(); }
  stop() { this.controller?.abort(); }

  snapshot() {
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, info: { ...this.info }, lastReport: this.store.getSettings?.()?.[this.reportKey] || null };
  }

  async _anonSim(signal) {
    if (this.anonSim?.socket?.connected) return this.anonSim;
    this.anonSim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, signal });
    return this.anonSim;
  }
  _closeAnon() { try { this.anonSim?.close(); } catch {} this.anonSim = null; }
  async _activeMatch(userId, signal) {
    return (await (await this._anonSim(signal)).ack('getUserActiveMatch', { userId }, { signal, timeoutMs: 10000 }))?.match || null;
  }

  // An earlier match (e.g. Auto Play's last one) has to end first.
  async _waitOtherMatch(id, userId, signal) {
    const until = this.now() + this.timing.matchMaxMs;
    let logged = false;
    while (await this._activeMatch(userId, signal)) {
      if (!logged) { this._log(id, 'info', 'waitMatch', {}, 'Already in a match · waiting for it to end'); logged = true; }
      if (this.now() > until) throw new Error('The match did not end in time.');
      this._row(id, { status: 'otherMatch' });
      await sleep(this.timing.pollMs, signal);
    }
  }

  // After a started match: it shows up, then disappears when over.
  async _waitMatchEnd(id, userId, signal) {
    this._row(id, { status: 'playing', matchStartedAt: new Date(this.now()).toISOString() });
    const appear = this.now() + this.timing.appearGraceMs;
    let m = await this._activeMatch(userId, signal);
    while (!m && this.now() < appear) { await sleep(this.timing.pollMs, signal); m = await this._activeMatch(userId, signal); }
    const until = this.now() + this.timing.matchMaxMs;
    while (m) {
      if (this.now() > until) throw new Error('The match did not end in time.');
      await sleep(this.timing.pollMs, signal);
      m = await this._activeMatch(userId, signal);
    }
    await sleep(1500, signal); // results are written right after the match
  }

  async runAndWait(plan, { signal, source = 'manual' } = {}) {
    if (this.controller) throw new Error(`${this.taskName} is already running.`);
    const ids = Object.keys(plan).filter(id => this.store.getAccounts().some(a => a.id === id));
    if (!ids.length) throw new Error('Select at least one account.');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.controller = controller;
    this.run = { startedAt: new Date(this.now()).toISOString(), source, accounts: {} };
    for (const id of ids) this.run.accounts[id] = { accountId: id, name: this._name(id), status: 'queued', played: 0, won: 0, lost: 0, left: null, target: plan[id], reason: null, last: null };
    this._log(null, 'info', 'start', { count: ids.length }, `${this.taskName} started · ${ids.length} account(s)`);
    this.onChanged();
    try {
      await Promise.all(ids.map(id => this._safe(id, controller.signal)));
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this._report(controller.signal.aborted);
      this.controller = null;
      this.run = null;
      this._closeAnon();
      this.onChanged();
    }
    if (signal?.aborted) throw abortError();
    return this.snapshot();
  }

  async _safe(id, signal) {
    let retry = false;
    try {
      if (this.gameHealth?.isDown()) { this._row(id, { status: 'waitingGame' }); await this.gameHealth.waitUp(signal); }
      await this._account(id, signal);
    } catch (error) {
      if (error?.name === 'AbortError') { this._row(id, { status: 'stopped', reason: 'stopped' }); return; }
      if (this.gameHealth && isNetError(error)) {
        this.gameHealth.reportDown(this.taskName, error);
        this._row(id, { status: 'waitingGame' });
        retry = true;
      } else {
        if (/auth|session|login/i.test(error.message)) this.sessions.invalidate?.(id);
        this._row(id, { status: 'error', reason: error.message });
        this._log(id, 'error', 'failed', { error: error.message }, `${this.taskName} stopped: ${error.message}`);
      }
    }
    if (retry) {
      try { await this.gameHealth.waitUp(signal); } catch { this._row(id, { status: 'stopped', reason: 'stopped' }); return; }
      return this._safe(id, signal);
    }
  }

  _report(stopped) {
    const final = ['done', 'noAttempts', 'error', 'locked'];
    const rows = Object.values(this.run.accounts).map(r => ({ ...r, status: final.includes(r.status) ? r.status : (stopped ? 'stopped' : r.status) }));
    const report = { startedAt: this.run.startedAt, finishedAt: new Date(this.now()).toISOString(), source: this.run.source, rows };
    const settings = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...settings, [this.reportKey]: report });
    const played = rows.reduce((n, r) => n + r.played, 0);
    const won = rows.reduce((n, r) => n + r.won, 0);
    const done = rows.filter(r => r.status === 'done' || r.status === 'noAttempts').length;
    this._log(null, done === rows.length ? 'success' : 'warning', 'summary', { done, total: rows.length, played, won }, `${this.taskName} result · ${done}/${rows.length} account(s) finished · ${played} match(es) · ${won} won`);
  }
}

class DailyBossService extends ProvingBase {
  constructor(deps) { super(deps, { taskName: 'Daily Boss', prefix: 'bo', reportKey: 'dailyBossReport' }); this.bosses = []; }

  snapshot() { return { ...super.snapshot(), bosses: this.bosses }; }

  async _readBoss(id, userId, signal) {
    const sim = await this._anonSim(signal);
    const b = await sim.ack('dailyBoss:getBosses', { userId }, { signal, timeoutMs: 10000 });
    const a = await sim.ack('dailyBoss:getAttempts', { userId }, { signal, timeoutMs: 10000 });
    if (!b?.success) throw new Error(b?.error || 'Daily Boss list could not be read.');
    this.bosses = (b.bosses || []).map(x => ({ id: x.id, name: x.name, tier: x.tier, levelRequired: Number(x.levelRequired) || 0, botId: x.botUser?.id || null })).sort((p, q) => p.levelRequired - q.levelRequired);
    const clears = Object.fromEntries((b.bosses || []).map(x => [x.id, Number(x.progress?.totalClears) || 0]));
    this.info[id] = { level: Number(b.userLevel) || null, left: a?.success ? Number(a.remaining) : null, max: a?.success ? Number(a.max) : 2, clears, readAt: new Date(this.now()).toISOString() };
    return this.info[id];
  }

  // Level and attempts of every account plus the boss list (no sign-in).
  async status(accountIds) {
    const ids = accountIds || this.store.getAccounts().map(a => a.id);
    try { for (const id of ids) { const u = this._userId(id); if (u) await this._readBoss(id, u).catch(() => null); } }
    finally { if (!this.controller) this._closeAnon(); this.onChanged(); }
    return this.snapshot();
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    let userId = this._userId(id);
    if (!userId) { this._row(id, { status: 'login' }); userId = (await this.sessions.get(account, { owner: 'daily-boss' })).userId; }
    let info = await this._readBoss(id, userId, signal);
    const boss = this.bosses.find(b => b.id === this.run.accounts[id].target);
    if (!boss) throw new Error('Choose a boss for this account.');
    this._row(id, { bossName: boss.name, left: info.left });
    if (info.level != null && info.level < boss.levelRequired) {
      this._row(id, { status: 'locked', reason: `Lv ${boss.levelRequired}` });
      this._log(id, 'warning', 'locked', { boss: boss.name, level: boss.levelRequired }, `${boss.name} needs level ${boss.levelRequired}`);
      return;
    }
    await this._waitOtherMatch(id, userId, signal);
    let sim = null;
    let failures = 0;
    try {
      while (info.left == null || info.left > 0) {
        if (!sim) {
          this._row(id, { status: 'login' });
          const session = await this.sessions.get(account, { owner: 'daily-boss' });
          userId = session.userId;
          sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: session.cookieHeader, signal });
        }
        this._row(id, { status: 'starting' });
        const r = await sim.ack('playDailyBossMatch', { userId, bossId: boss.id, opponentId: boss.botId }, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.error || r?.message || 'refused');
          if (NO_ATTEMPTS.test(msg)) break;
          failures++;
          this._log(id, 'warning', 'startFailed', { error: msg, n: failures }, `Daily Boss match refused: ${msg}`);
          if (failures >= MAX_FAILURES) throw new Error(msg);
          await this._waitOtherMatch(id, userId, signal);
          await sleep(this.timing.pollMs, signal);
          continue;
        }
        failures = 0;
        const n = this.run.accounts[id].played + 1;
        this._log(id, 'info', 'matchStarted', { n, boss: boss.name }, `Daily Boss match ${n} started · ${boss.name}`);
        const clearsBefore = info.clears[boss.id] || 0;
        await this._waitMatchEnd(id, userId, signal);
        info = await this._readBoss(id, userId, signal);
        const won = (info.clears[boss.id] || 0) > clearsBefore;
        const row = this.run.accounts[id];
        this._row(id, { played: n, won: row.won + (won ? 1 : 0), lost: row.lost + (won ? 0 : 1), left: info.left, last: won ? 'won' : 'lost' });
        this._log(id, won ? 'success' : 'warning', won ? 'matchWon' : 'matchLost', { n, boss: boss.name, result: won ? 'won' : 'lost', left: info.left ?? '?' }, `Daily Boss match ${n} · ${boss.name} · ${won ? 'won' : 'lost'} · ${info.left ?? '?'} attempt(s) left`);
      }
    } finally { try { sim?.close(); } catch {} }
    this._row(id, { status: this.run.accounts[id].played ? 'done' : 'noAttempts', left: 0 });
  }
}

class EliteAscentService extends ProvingBase {
  constructor(deps) { super(deps, { taskName: 'Elite Ascent', prefix: 'ea', reportKey: 'eliteAscentReport' }); }

  // Floors and attempts need a registered /socket/ (an open game tab of the account is signed out).
  async _main(account, signal) {
    const session = await this.sessions.get(account, { owner: 'elite-ascent' });
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    await gs.register(session.userId, { signal, owner: 'Elite Ascent' });
    return { gs, session };
  }

  async _readAscent(id, gs, signal) {
    const d = await gs.call('backToPeak:getData', undefined, 'backToPeak:data', { signal, timeoutMs: 15000 });
    if (!d?.success) throw new Error(d?.error || 'Elite Ascent could not be read.');
    const a = await gs.call('backToPeak:getAttempts', undefined, 'backToPeak:attempts', { signal, timeoutMs: 10000 });
    const p = d.data?.progress || {};
    const floor = Number(p.currentFloor) || 1;
    const next = (d.data?.floors || []).find(f => Number(f.floorNumber) === floor);
    this.info[id] = { floor, highest: Number(p.highestFloor) || null, completed: Boolean(p.isCompleted), left: a?.success ? Number(a.attemptsRemaining) : null, used: a?.success ? Number(a.attemptsUsed) : null, enemyId: next?.enemyUser?.id || null, enemy: next?.enemyUser?.teamName || null, readAt: new Date(this.now()).toISOString() };
    return this.info[id];
  }

  // Signs each account in briefly to read its floor and attempts.
  async status(accountIds) {
    const ids = accountIds || this.store.getAccounts().map(a => a.id);
    for (const id of ids) {
      const account = this.store.getAccounts().find(a => a.id === id);
      if (!account) continue;
      let gs = null;
      try { ({ gs } = await this._main(account)); await this._readAscent(id, gs); } catch {} finally { try { gs?.close(); } catch {} }
    }
    this.onChanged();
    return this.snapshot();
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    this._row(id, { status: 'login' });
    const { gs, session } = await this._main(account, signal);
    const userId = session.userId;
    let sim = null;
    let failures = 0;
    try {
      let info = await this._readAscent(id, gs, signal);
      this._row(id, { left: info.left, floor: info.floor, floorStart: info.floor });
      if (info.completed) { this._row(id, { status: 'done', reason: 'completed' }); return; }
      await this._waitOtherMatch(id, userId, signal);
      sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: session.cookieHeader, signal });
      while (info.left == null || info.left > 0) {
        if (!info.enemyId) throw new Error(`Floor ${info.floor} could not be read.`);
        this._row(id, { status: 'starting', enemy: info.enemy });
        const r = await sim.ack('playBackToPeakMatch', { userId, opponentId: info.enemyId, floorNumber: info.floor }, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.error || r?.message || 'refused');
          if (NO_ATTEMPTS.test(msg) && !/floor/i.test(msg)) break;
          failures++;
          this._log(id, 'warning', 'startFailed', { error: msg, n: failures }, `Elite Ascent match refused: ${msg}`);
          if (failures >= MAX_FAILURES) throw new Error(msg);
          info = await this._readAscent(id, gs, signal);
          await sleep(this.timing.pollMs, signal);
          continue;
        }
        failures = 0;
        const n = this.run.accounts[id].played + 1;
        const floor = info.floor;
        this._log(id, 'info', 'matchStarted', { n, floor, enemy: info.enemy || '?' }, `Elite Ascent match ${n} started · floor ${floor}`);
        await this._waitMatchEnd(id, userId, signal);
        info = await this._readAscent(id, gs, signal);
        const won = info.floor > floor;
        const row = this.run.accounts[id];
        this._row(id, { played: n, won: row.won + (won ? 1 : 0), lost: row.lost + (won ? 0 : 1), left: info.left, floor: info.floor, last: won ? 'won' : 'lost' });
        this._log(id, won ? 'success' : 'warning', won ? 'matchWon' : 'matchLost', { n, floor, result: won ? 'won' : 'lost', next: info.floor, left: info.left ?? '?' }, `Elite Ascent match ${n} · floor ${floor} · ${won ? 'won' : 'lost'} · now floor ${info.floor} · ${info.left ?? '?'} attempt(s) left`);
        if (info.completed) break;
      }
    } finally {
      try { sim?.close(); } catch {}
      try { gs.close(); } catch {}
    }
    this._row(id, { status: this.run.accounts[id].played ? 'done' : 'noAttempts', left: 0 });
  }
}

module.exports = { DailyBossService, EliteAscentService };
