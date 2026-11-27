const { GameSocket } = require('./game-socket.cjs');
const { handleInjury, InjuredError } = require('./injury-guard.cjs');
const { WIDE, eachAtOnce, eachWithSocket, eachStaggered } = require('./wide.cjs');
const { isNetError } = require('./game-health.cjs');

// Go-up over the game's sockets (read from the game client 2026-10-23):
//   /socket/            getGoUpData {userId} (ack) -> {success, data: {goUpValue (this season),
//                       goUpPoints (total), currentTier {name, stage, level}, attemptsUsed,
//                       attemptsRemaining, maxAttempts, isEventActive, eventTimeInfo, eventDateRange}}
//   /simulation-socket/ findGoUpMatch {userId} (ack) -> {success, matchId, server} or {error}
//                       — the account joins the queue ("waiting") until an opponent is found
//   /simulation-socket/ getGoUpMatches {userId} (ack) -> {matches[], tierCounts, userMatch}
//                       userMatch: {match_id, status: 'waiting' | 'started', ...} or null
//   /simulation-socket/ cancelGoUpSearch {userId} (ack) — leaves the queue
// Reads need no login; finding uses the account's cookie (no `register`). 2 attempts a
// day, reset ~19:10 TR. The event is always on except 1–2 days at the 2-month season
// reset. No shop purchases.
const SIM_PATH = '/simulation-socket/';
const POLL_MS = 3000;
const APPEAR_GRACE_MS = 30000;            // a found match shows up in getGoUpMatches within this
const MATCH_MAX_MS = 20 * 60 * 1000;      // once started, a match never takes longer
const MAX_FIND_FAILURES = 3;
// A read the game does not answer (2026-11-21 17:16: all 141 accounts stopped mid-match with
// "No reply to getGoUpMatches" — every account polled ONE shared socket). Now each account polls on
// its own socket, an unanswered read is asked again on a fresh shared one (READ_TRIES), and if the
// game still says nothing the account waits RESTART_MS and goes on where it was (MAX_RESTARTS).
const READ_TIMEOUT_MS = 10000;
const READ_TRIES = 3;
const READ_RETRY_MS = 1000;
const RESTART_MS = 15000;
const MAX_RESTARTS = 3;
const isNoReply = error => /no reply/i.test(String(error?.message || ''));

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class InactiveError extends Error {}

function pointsOf(data) {
  if (!data) return null;
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    season: num(data.goUpValue),
    total: num(data.goUpPoints),
    tier: data.currentTier ? { name: data.currentTier.name || data.currentTier.stage || '', level: num(data.currentTier.level) } : null,
    left: num(data.attemptsRemaining),
    max: num(data.maxAttempts),
    active: data.isEventActive === true,
    eventInfo: data.eventTimeInfo || '',
    eventRange: data.eventDateRange || ''
  };
}

class GoUpService {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now(), timing = {} }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, now });
    this.onChanged = onChanged || (() => {});
    this.timing = { pollMs: POLL_MS, appearGraceMs: APPEAR_GRACE_MS, matchMaxMs: MATCH_MAX_MS, readTimeoutMs: READ_TIMEOUT_MS, readRetryMs: READ_RETRY_MS, restartMs: RESTART_MS, ...timing };
    this.run = null;
    this.controller = null;
    this.points = {};         // accountId -> pointsOf(...) + readAt
    this.event = null;        // { active, info, range, checkedAt }
  }

  snapshot() {
    return {
      running: Boolean(this.controller),
      run: this.run ? JSON.parse(JSON.stringify(this.run)) : null,
      points: { ...this.points },
      event: this.event,
      lastReport: this.store.getGoUpReport?.() || null
    };
  }

  _name(id) { return this.store.getAccounts().find(a => a.id === id)?.name || id; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'Go-up', code, params, message });
  }
  _row(id, patch) { Object.assign(this.run.accounts[id], patch); this.onChanged(); }

  stop() { this.controller?.abort(); }

  // one shared reading socket; 141 accounts asking at once open it once (not 141 times)
  async _anon(signal) {
    if (this.anon?.socket?.connected) return this.anon;
    if (!this.anonOpening) this.anonOpening = GameSocket.open({ createSocket: this.createSocket, signal }).then(gs => { this.anon = gs; return gs; }).finally(() => { this.anonOpening = null; });
    return this.anonOpening;
  }
  // opened once even when every account needs it at the same moment (it used to open one per caller)
  async _anonSim(signal) {
    if (this.anonSim?.socket?.connected) return this.anonSim;
    if (!this.anonSimOpening) this.anonSimOpening = GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, signal }).then(gs => { this.anonSim = gs; return gs; }).finally(() => { this.anonSimOpening = null; });
    return this.anonSimOpening;
  }
  _dropAnonSim(gs) {
    if (gs && this.anonSim === gs) { try { gs.close(); } catch {} this.anonSim = null; }
  }
  // A simulation-socket read: first on the account's own socket (when it has one), then on a fresh
  // shared socket; an unanswered read throws only after READ_TRIES.
  async _simRead(event, payload, signal, own = null) {
    let last = null;
    for (let i = 0; i < READ_TRIES; i++) {
      const gs = i === 0 && own?.socket?.connected ? own : await this._anonSim(signal);
      try {
        return await gs.ack(event, payload, { signal, timeoutMs: this.timing.readTimeoutMs });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        last = error;
        if (gs !== own) this._dropAnonSim(gs); // a shared socket that stopped answering: open a new one
        if (i < READ_TRIES - 1) await sleep(this.timing.readRetryMs * (i + 1), signal);
      }
    }
    throw last;
  }
  _closeAnon() {
    try { this.anon?.close(); } catch {}
    try { this.anonSim?.close(); } catch {}
    this.anon = null; this.anonSim = null;
  }

  async _read(id, userId, signal) {
    // the shared socket drops some answers when every account asks at once (2026-11-20: 141 accounts
    // stopped with 'No reply to getGoUpData'): no answer → asked once more on a socket of its own
    let r = await (await this._anon(signal)).ack('getGoUpData', { userId }, { signal, timeoutMs: 10000 }).catch(error => { if (error?.name === 'AbortError') throw error; return null; });
    if (!r) {
      const own = await GameSocket.open({ createSocket: this.createSocket, signal });
      try { r = await own.ack('getGoUpData', { userId }, { signal, timeoutMs: 15000 }); } finally { try { own.close(); } catch {} }
    }
    const p = r?.success ? pointsOf(r.data) : null;
    if (p) {
      this.points[id] = { ...p, readAt: new Date(this.now()).toISOString() };
      this.event = { active: p.active, info: p.eventInfo, range: p.eventRange, checkedAt: this.points[id].readAt };
    }
    return p;
  }
  async _userMatch(userId, signal, own = null) {
    return (await this._simRead('getGoUpMatches', { userId }, signal, own))?.userMatch || null;
  }
  async _activeMatch(userId, signal, own = null) {
    return (await this._simRead('getUserActiveMatch', { userId }, signal, own))?.match || null;
  }

  // Points, league and attempts of every account (no login). Used by the page.
  async status(accountIds) {
    const ids = accountIds || this.store.getAccounts().map(a => a.id);
    try {
      await this._anon();
      await eachAtOnce(ids, async id => { const userId = this._userId(id); if (userId) await this._read(id, userId).catch(() => null); });
    } finally {
      if (!this.controller) this._closeAnon();
      this.onChanged();
    }
    return this.snapshot();
  }

  // Plays Go-up on every account until its daily attempts are used. mode 'parallel'
  // starts all accounts at once; 'staggered' waits gapSec between account starts.
  async runAndWait(accountIds, { signal, source = 'manual', mode = 'parallel', gapSec = 0 } = {}) {
    if (this.controller) throw new Error('Go-up is already running.');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.controller = controller;
    const ids = accountIds.filter(id => this.store.getAccounts().some(a => a.id === id));
    const gap = mode === 'staggered' ? Math.max(0, Number(gapSec) || 0) : 0;
    this.run = { startedAt: new Date(this.now()).toISOString(), source, mode: gap ? 'staggered' : 'parallel', gapSec: gap, accounts: {} };
    ids.forEach((id, i) => {
      this.run.accounts[id] = { accountId: id, name: this._name(id), status: 'queued', played: 0, lastDiff: null, attemptsLeft: null, startAt: gap ? new Date(this.now() + i * gap * 1000).toISOString() : null, queuedAt: null, matchStartedAt: null, seasonStart: null, totalStart: null, season: null, total: null, tier: null, reason: null };
    });
    this._log(null, 'info', 'gu.start', { count: ids.length, mode: this.run.mode, gap }, `Go-up started · ${ids.length} account(s)${gap ? ` · ${gap} s apart` : ''}`);
    this.onChanged();
    try {
      // at most WIDE (200) accounts STARTING at once: the next 200 start as soon as these have
      // their first match, not when their whole run is over (user 2026-11-25 → 11-27)
      // (one after another with a gap keeps its own timing: every account waits i × gap from the start)
      this._started = new Map();
      if (gap) await Promise.all(ids.map((id, i) => this._account(id, controller.signal, i * gap * 1000)));
      else await eachStaggered(ids, (id, _i, started) => { this._started.set(id, started); return this._account(id, controller.signal, 0); }, WIDE);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      const report = this._report(controller.signal.aborted);
      this.store.saveGoUpReport?.(report);
      this.controller = null;
      this.run = null;
      this._closeAnon();
      this.onChanged();
    }
    if (signal?.aborted) throw abortError();
    return this.snapshot();
  }

  _report(stopped) {
    const final = ['done', 'inactive', 'error', 'noAttempts'];
    const rows = Object.values(this.run.accounts).map(r => ({ ...r, status: final.includes(r.status) ? r.status : (stopped ? 'stopped' : r.status) }));
    const report = { startedAt: this.run.startedAt, finishedAt: new Date(this.now()).toISOString(), source: this.run.source, rows };
    for (const r of rows) {
      const ok = r.status === 'done' || r.status === 'noAttempts';
      const gain = r.season != null && r.seasonStart != null ? r.season - r.seasonStart : null;
      this._log(r.accountId, ok ? 'success' : 'warning', ok ? 'gu.resultDone' : 'gu.resultCut',
        { played: r.played, season: r.season ?? '?', total: r.total ?? '?', gain: gain == null ? '?' : (gain >= 0 ? `+${gain}` : String(gain)), reason: r.reason || r.status },
        ok ? `Go-up finished · ${r.played} match(es) · season ${r.season ?? '?'} · total ${r.total ?? '?'}` : `Go-up interrupted (${r.reason || r.status}) · ${r.played} match(es)`);
    }
    const played = rows.reduce((n, r) => n + r.played, 0);
    const done = rows.filter(r => r.status === 'done' || r.status === 'noAttempts').length;
    this._log(null, done === rows.length ? 'success' : 'warning', 'gu.summary', { done, total: rows.length, played }, `Go-up result · ${done}/${rows.length} account(s) finished · ${played} match(es)`);
    return report;
  }

  _applyPoints(id, p) {
    if (!p) return;
    const row = this.run.accounts[id];
    this._row(id, {
      season: p.season, total: p.total, tier: p.tier, attemptsLeft: p.left,
      seasonStart: row.seasonStart ?? p.season, totalStart: row.totalStart ?? p.total
    });
  }

  async _waitOtherMatch(id, userId, signal) {
    const until = this.now() + this.timing.matchMaxMs;
    let logged = false;
    while (await this._activeMatch(userId, signal)) {
      if (!logged) { this._log(id, 'info', 'gu.waitMatch', {}, 'Already in a match · Go-up waits for it to end'); logged = true; }
      if (this.now() > until) throw new Error('The match did not end in time.');
      this._row(id, { status: 'otherMatch' });
      await sleep(this.timing.pollMs, signal);
    }
  }

  async _account(id, signal, delayMs = 0, restarts = 0) {
    const account = this.store.getAccounts().find(a => a.id === id);
    let sim = null;
    let userId = this._userId(id);
    let retry = false;
    let again = false;
    try {
      if (delayMs > 0) { this._row(id, { status: 'waitingStart' }); await sleep(delayMs, signal); }
      if (this.gameHealth?.isDown()) { this._row(id, { status: 'waitingGame' }); await this.gameHealth.waitUp(signal); }
      if (!userId) { this._row(id, { status: 'login' }); userId = (await this.sessions.get(account, { owner: 'goup' })).userId; }
      let p = await this._read(id, userId, signal);
      this._applyPoints(id, p);
      if (p && !p.active) throw new InactiveError();
      await this._waitOtherMatch(id, userId, signal);
      let failures = 0;
      while (p == null || p.left == null || p.left > 0) {
        if (!sim) {
          this._row(id, { status: 'login' });
          const session = await this.sessions.get(account, { owner: 'goup' });
          userId = session.userId;
          sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: session.cookieHeader, signal });
        }
        this._row(id, { status: 'finding', queuedAt: null, matchStartedAt: null });
        const r = await sim.ack('findGoUpMatch', { userId }, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.error || r?.message || 'refused');
          if (/attempt|limit|no more|remaining/i.test(msg)) break;
          if (/inactive|not active|event/i.test(msg)) throw new InactiveError(msg);
          const inj = await handleInjury(id, msg, 'Go-up');
          if (inj === false) throw new InjuredError(msg);
          if (inj === true) continue;
          failures++;
          this._log(id, 'warning', 'gu.findFailed', { error: msg, n: failures }, `Find Go-up match refused: ${msg}`);
          if (failures >= MAX_FIND_FAILURES) throw new Error(msg);
          await this._waitOtherMatch(id, userId, signal);
          await sleep(this.timing.pollMs, signal);
          continue;
        }
        failures = 0;
        const n = this.run.accounts[id].played + 1;
        this._row(id, { status: 'searching', queuedAt: new Date(this.now()).toISOString() });
        this._log(id, 'info', 'gu.queued', { n }, `Go-up match ${n} · in the queue, waiting for an opponent`);
        // Queue (waiting) → started → gone. The queue may take long: no time limit
        // there, the Stop button leaves the queue.
        const appearUntil = this.now() + this.timing.appearGraceMs;
        let m = await this._userMatch(userId, signal, sim);
        while (!m && this.now() < appearUntil) { await sleep(this.timing.pollMs, signal); m = await this._userMatch(userId, signal, sim); }
        let started = false;
        let until = Infinity;
        while (m) {
          if (m.status === 'started' && !started) {
            started = true;
            until = this.now() + this.timing.matchMaxMs;
            this._row(id, { status: 'playing', played: n, matchStartedAt: new Date(this.now()).toISOString(), opponent: (m.host === userId ? m.opponentName : m.hostName) || null });
            this._log(id, 'info', 'gu.matchStarted', { n, opponent: this.run.accounts[id].opponent || '?' }, `Go-up match ${n} started`);
            this._started?.get(id)?.();
          }
          if (this.now() > until) throw new Error('The match did not end in time.');
          await sleep(this.timing.pollMs, signal);
          m = await this._userMatch(userId, signal, sim);
        }
        if (!started) this._row(id, { played: n });
        const before = this.run.accounts[id].season;
        p = await this._read(id, userId, signal);
        this._applyPoints(id, p);
        const diff = p?.season != null && before != null ? p.season - before : null;
        if (diff != null) this._row(id, { lastDiff: diff });
        this._log(id, 'success', 'gu.matchDone', { n, diff: diff == null ? '?' : (diff >= 0 ? `+${diff}` : String(diff)), season: p?.season ?? '?', total: p?.total ?? '?', left: p?.left ?? '?' },
          `Go-up match ${n} finished · season ${p?.season ?? '?'} · total ${p?.total ?? '?'} · ${p?.left ?? '?'} attempt(s) left`);
        if (p && !p.active) throw new InactiveError();
      }
      const played = this.run.accounts[id].played;
      this._row(id, { status: played ? 'done' : 'noAttempts', attemptsLeft: 0, queuedAt: null });
    } catch (error) {
      if (error?.name === 'AbortError') {
        const wasQueued = this.run.accounts[id].status === 'searching';
        this._row(id, { status: 'stopped', reason: 'stopped' });
        if (wasQueued && sim && userId) {
          await sim.ack('cancelGoUpSearch', { userId }, { timeoutMs: 8000 }).catch(() => null);
          this._log(id, 'info', 'gu.cancelled', {}, 'Left the Go-up queue');
        }
        return;
      }
      if (error instanceof InactiveError) {
        this._row(id, { status: 'inactive', reason: 'inactive' });
        this._log(id, 'warning', 'gu.inactive', { info: this.event?.info || '' }, `Go-up is not active right now (${this.event?.info || 'season break'}) · stopped`);
        return;
      }
      if (this.gameHealth && isNetError(error)) {
        this.gameHealth.reportDown('Go-up', error);
        this._row(id, { status: 'waitingGame' });
        this._closeAnon();
        retry = true;
        return;
      }
      // the game did not answer even after the retries: not the end of this account's Go-up — it
      // goes on after a pause (waits for a running match first, the played count is kept)
      if (isNoReply(error) && restarts < MAX_RESTARTS) {
        this._row(id, { status: 'waitingGame', reason: null });
        this._log(id, 'warning', 'gu.noReply', { error: error.message, s: Math.round(this.timing.restartMs / 1000), n: restarts + 1, max: MAX_RESTARTS },
          `The game did not answer (${error.message}) · Go-up goes on in ${Math.round(this.timing.restartMs / 1000)} s (${restarts + 1}/${MAX_RESTARTS})`);
        again = true;
        return;
      }
      if (/auth|session|login/i.test(error.message)) this.sessions.invalidate?.(id);
      this._row(id, { status: 'error', reason: error.message });
      this._log(id, 'error', 'gu.failed', { error: error.message }, `Go-up stopped: ${error.message}`);
    } finally {
      try { sim?.close(); } catch {}
      if (retry) {
        try { await this.gameHealth.waitUp(signal); } catch { this._row(id, { status: 'stopped', reason: 'stopped' }); return; }
        return this._account(id, signal);
      }
      if (again) {
        try { await sleep(this.timing.restartMs, signal); } catch { this._row(id, { status: 'stopped', reason: 'stopped' }); return; }
        return this._account(id, signal, 0, restarts + 1);
      }
    }
  }
}

module.exports = { GoUpService, pointsOf };
