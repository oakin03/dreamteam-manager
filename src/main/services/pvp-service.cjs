const { GameSocket } = require('./game-socket.cjs');

// PVP Arena over the game's sockets (captured 2026-10-22):
//   /socket/            getPvpArenaStatus {}          -> pvpArenaStatus {success, isActive, nextSession: null | 'morning' | 'evening'}
//                       (closed: the page shows a disabled ARENA INACTIVE button instead of FIND PVP MATCH)
//   /socket/            getUserBasicInfo {userId}     -> userBasicInfo {PVParenaAttempts (left today), mmr, ...}
//   /simulation-socket/ findPvpMatch {userId}  (ack)  -> {success, matchId, server}   (the button turns into WATCH MATCH)
//   /simulation-socket/ getUserPVPMatch {userId} (ack) -> {success, match | null}       (null = back to FIND PVP MATCH)
//   /simulation-socket/ getUserActiveMatch {userId} (ack) -> any running match (PK, Friendly, PVP)
// Reads need no login; finding a match uses the account's cookie (no `register`, so
// an open game tab stays signed in). 10 attempts a day, reset at 19:10 TR. The arena
// opens twice a day (17:00 / 05:00 TR) but may be opened by hand, so there is no
// time gate: the arena status decides.
const SIM_PATH = '/simulation-socket/';
const POLL_MS = 3000;
const APPEAR_GRACE_MS = 30000;           // a found match shows up in getUserPVPMatch within this
const MATCH_MAX_MS = 15 * 60 * 1000;     // a match lasts ~4 min; never wait forever
const MAX_FIND_FAILURES = 3;

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

class PvpService {
  constructor({ store, activity, sessions, onChanged, createSocket, now = () => Date.now(), timing = {} }) {
    this.store = store;
    this.activity = activity;
    this.sessions = sessions;
    this.onChanged = onChanged || (() => {});
    this.createSocket = createSocket;
    this.now = now;
    this.timing = { pollMs: POLL_MS, appearGraceMs: APPEAR_GRACE_MS, matchMaxMs: MATCH_MAX_MS, ...timing };
    this.run = null;        // live run: { startedAt, accounts: { id: row } }
    this.controller = null;
  }

  snapshot() {
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, lastReport: this.store.getPvpReport?.() || null, status: this.lastStatus || null };
  }

  _name(id) { return this.store.getAccounts().find(a => a.id === id)?.name || id; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'PVP', code, params, message });
  }
  _row(id, patch) { Object.assign(this.run.accounts[id], patch); this.onChanged(); }

  stop() { this.controller?.abort(); }

  // For the PVP page: is the arena open and how many attempts each account has left
  // (read without logging in).
  async status(accountIds) {
    const out = { checkedAt: new Date(this.now()).toISOString(), active: null, attempts: {} };
    const anon = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const st = await anon.call('getPvpArenaStatus', {}, 'pvpArenaStatus', { timeoutMs: 10000 }).catch(() => null);
      out.active = st ? st.isActive === true : null;
      out.nextSession = st?.nextSession || null; // 'morning' (05:00 TR) / 'evening' (17:00 TR) while closed
      for (const id of accountIds) {
        const userId = this._userId(id);
        if (!userId) continue;
        const r = await anon.call('getUserBasicInfo', { userId }, 'userBasicInfo', { timeoutMs: 10000 }).catch(() => null);
        const n = Number(r?.PVParenaAttempts);
        if (Number.isFinite(n)) out.attempts[id] = n;
      }
    } finally { anon.close(); }
    this.lastStatus = out;
    this.onChanged();
    return out;
  }

  // Plays PVP on every account until its attempts are used up. Accounts run side by
  // side; one account stopping (arena closed, error) never stops the others.
  async runAndWait(accountIds, { signal, source = 'manual' } = {}) {
    if (this.controller) throw new Error('PVP is already running.');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.controller = controller;
    const ids = accountIds.filter(id => this.store.getAccounts().some(a => a.id === id));
    this.run = { startedAt: new Date(this.now()).toISOString(), source, accounts: {} };
    for (const id of ids) this.run.accounts[id] = { accountId: id, name: this._name(id), status: 'queued', played: 0, attemptsStart: null, attemptsLeft: null, reason: null, message: '' };
    this._log(null, 'info', 'pvp.start', { count: ids.length }, `PVP started · ${ids.length} account(s)`);
    this.onChanged();
    try {
      await Promise.all(ids.map(id => this._account(id, controller.signal)));
    } finally {
      signal?.removeEventListener('abort', onAbort);
      const report = this._report(controller.signal.aborted);
      this.store.savePvpReport?.(report);
      this.controller = null;
      this.run = null;
      this.onChanged();
    }
    if (signal?.aborted) throw abortError();
    return this.snapshot();
  }

  _report(stopped) {
    const rows = Object.values(this.run.accounts).map(r => ({ ...r, status: r.status === 'done' || r.status === 'inactive' || r.status === 'error' ? r.status : (stopped ? 'stopped' : r.status) }));
    const report = { startedAt: this.run.startedAt, finishedAt: new Date(this.now()).toISOString(), source: this.run.source, rows };
    const done = rows.filter(r => r.status === 'done');
    const played = rows.reduce((n, r) => n + r.played, 0);
    // One line per account, then the total: the "result screen" in the logs.
    for (const r of rows) {
      const code = r.status === 'done' ? 'pvp.resultDone' : 'pvp.resultCut';
      this._log(r.accountId, r.status === 'done' ? 'success' : 'warning', code, { played: r.played, reason: r.reason || r.status, left: r.attemptsLeft ?? '?' },
        r.status === 'done' ? `PVP finished · ${r.played} match(es)` : `PVP interrupted (${r.reason || r.status}) · ${r.played} match(es) · ${r.attemptsLeft ?? '?'} attempt(s) left`);
    }
    this._log(null, done.length === rows.length ? 'success' : 'warning', 'pvp.summary', { done: done.length, total: rows.length, played },
      `PVP result · ${done.length}/${rows.length} account(s) finished · ${played} match(es) played`);
    return report;
  }

  async _anon(signal) {
    if (this.anon?.socket?.connected) return this.anon;
    this.anon = await GameSocket.open({ createSocket: this.createSocket, signal });
    return this.anon;
  }
  async _anonSim(signal) {
    if (this.anonSim?.socket?.connected) return this.anonSim;
    this.anonSim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, signal });
    return this.anonSim;
  }
  async _arenaActive(signal) {
    const r = await (await this._anon(signal)).call('getPvpArenaStatus', {}, 'pvpArenaStatus', { signal, timeoutMs: 10000 });
    return r?.isActive === true;
  }
  async _attempts(userId, signal) {
    const r = await (await this._anon(signal)).call('getUserBasicInfo', { userId }, 'userBasicInfo', { signal, timeoutMs: 10000 });
    const n = Number(r?.PVParenaAttempts);
    return Number.isFinite(n) ? n : null;
  }
  async _activeMatch(userId, signal) {
    return (await (await this._anonSim(signal)).ack('getUserActiveMatch', { userId }, { signal, timeoutMs: 10000 }))?.match || null;
  }
  async _pvpMatch(userId, signal) {
    return (await (await this._anonSim(signal)).ack('getUserPVPMatch', { userId }, { signal, timeoutMs: 10000 }))?.match || null;
  }

  // Waits while the account plays any match (PVP or another one, e.g. Auto Play's PK).
  async _waitIdle(id, userId, signal, read = () => this._activeMatch(userId, signal)) {
    const until = this.now() + this.timing.matchMaxMs;
    let match = await read();
    while (match) {
      if (this.now() > until) throw new Error('The match did not end in time.');
      this._row(id, { status: 'playing', message: match.type === 'PVPARENA' ? 'pvp' : 'otherMatch' });
      await sleep(this.timing.pollMs, signal);
      match = await read();
    }
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    let sim = null;
    try {
      let userId = this._userId(id);
      if (!userId) { this._row(id, { status: 'login' }); userId = (await this.sessions.get(account, { owner: 'pvp' })).userId; }
      let left = await this._attempts(userId, signal);
      this._row(id, { attemptsStart: left, attemptsLeft: left });
      // Already in a match when the task starts: wait for it, then try.
      if (await this._activeMatch(userId, signal)) {
        this._log(id, 'info', 'pvp.waitMatch', {}, 'Already in a match · waiting for it to end');
        await this._waitIdle(id, userId, signal);
        left = await this._attempts(userId, signal);
        this._row(id, { attemptsLeft: left });
      }
      let failures = 0;
      while (left == null || left > 0) {
        if (!(await this._arenaActive(signal))) throw new InactiveError();
        if (!sim) {
          this._row(id, { status: 'login', message: '' });
          const session = await this.sessions.get(account, { owner: 'pvp' });
          userId = session.userId;
          sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: session.cookieHeader, signal });
        }
        this._row(id, { status: 'finding', message: '' });
        const r = await sim.ack('findPvpMatch', { userId }, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.message || r?.error || 'refused');
          if (/attempt|limit|no more|remaining/i.test(msg)) { left = 0; break; }
          if (!(await this._arenaActive(signal))) throw new InactiveError();
          failures++;
          this._log(id, 'warning', 'pvp.findFailed', { error: msg, n: failures }, `Find PVP Match refused: ${msg}`);
          if (failures >= MAX_FIND_FAILURES) throw new Error(msg);
          // Usually "already in a match": wait until it ends, then try again.
          await this._waitIdle(id, userId, signal);
          await sleep(this.timing.pollMs, signal);
          continue;
        }
        failures = 0;
        const n = this.run.accounts[id].played + 1;
        this._row(id, { status: 'playing', played: n, message: 'pvp' });
        this._log(id, 'info', 'pvp.matchStarted', { n, left: left == null ? '?' : left - 1 }, `PVP match ${n} started`);
        // The match shows up shortly after the find; then wait for it to end (the
        // button is FIND PVP MATCH again).
        const appearUntil = this.now() + this.timing.appearGraceMs;
        while (!(await this._pvpMatch(userId, signal)) && this.now() < appearUntil) await sleep(this.timing.pollMs, signal);
        await this._waitIdle(id, userId, signal, () => this._pvpMatch(userId, signal));
        left = await this._attempts(userId, signal);
        this._row(id, { attemptsLeft: left });
        this._log(id, 'success', 'pvp.matchDone', { n, left: left ?? '?' }, `PVP match ${n} finished · ${left ?? '?'} attempt(s) left`);
      }
      this._row(id, { status: 'done', attemptsLeft: 0, message: '' });
    } catch (error) {
      if (error?.name === 'AbortError') { this._row(id, { status: 'stopped', reason: 'stopped' }); return; }
      if (error instanceof InactiveError) {
        this._row(id, { status: 'inactive', reason: 'inactive' });
        this._log(id, 'error', 'pvp.inactive', {}, 'PVP task stopped because PVP is not active right now');
        return;
      }
      if (/auth|session|login/i.test(error.message)) this.sessions.invalidate?.(id);
      this._row(id, { status: 'error', reason: error.message });
      this._log(id, 'error', 'pvp.failed', { error: error.message }, `PVP stopped: ${error.message}`);
    } finally {
      try { sim?.close(); } catch {}
      if (!Object.values(this.run?.accounts || {}).some(r => !['done', 'inactive', 'error', 'stopped'].includes(r.status))) {
        try { this.anon?.close(); } catch {}
        try { this.anonSim?.close(); } catch {}
        this.anon = null; this.anonSim = null;
      }
    }
  }
}

module.exports = { PvpService };
