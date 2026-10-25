const { GameSocket } = require('./game-socket.cjs');
const { isNetError } = require('./game-health.cjs');

// Tower (Kule) over the game's sockets (captured 2026-10-22):
//   /socket/            towerChallenge:getTowerData (no payload, session user) -> towerChallenge:towerData
//                       {data:{modes[{id,name,displayName,sortOrder}], floorsByMode{modeId:[{floorNumber,enemyUserId}]},
//                              userProgress{modeId:{currentFloor,isCompleted}}}}
//   /simulation-socket/ playTowerChallengeMatch {userId, opponentId, floorNumber, modeId, mode} (ack)
//                       -> {success, matchId, server}
//   /simulation-socket/ getUserActiveMatch {userId} (ack) -> {match | null}
// A win moves the tower's currentFloor up by one; a loss leaves it. Three towers
// (challenger / threat / rival), ~60 floors, reset every Sunday 19:10 TR.
// Rules (user): play the lowest floor first across the towers; 3 losses in a row on
// the same floor give that tower up; when every tower is given up or done the account
// stops. A salary-cap refusal stops the account with the same alert as Auto Play.
const SIM_PATH = '/simulation-socket/';
const POLL_MS = 3000;
const APPEAR_GRACE_MS = 30000;
const MATCH_MAX_MS = 15 * 60 * 1000;
const MAX_LOSSES = 3;
const MAX_START_FAILURES = 3;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// The tower to play next: the lowest current floor among the towers still in play
// (ties in the game's order), so floor 1 of every tower comes before any floor 2.
function nextTower(towers) {
  return towers.filter(t => t.state === 'active').sort((a, b) => a.floor - b.floor || a.order - b.order)[0] || null;
}

class SalaryCapError extends Error {}

class TowerService {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now(), timing = {} }) {
    this.store = store;
    this.gameHealth = gameHealth;
    this.activity = activity;
    this.sessions = sessions;
    this.onChanged = onChanged || (() => {});
    this.createSocket = createSocket;
    this.now = now;
    this.timing = { pollMs: POLL_MS, appearGraceMs: APPEAR_GRACE_MS, matchMaxMs: MATCH_MAX_MS, cookieTryMs: 4000, ...timing };
    this.run = null;              // { startedAt, accounts: { id: row } }
    this.controllers = new Map(); // accountId -> AbortController
  }

  snapshot() {
    return { running: this.controllers.size > 0, run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, lastReport: this.store.getTowerReport?.() || null };
  }

  _name(id) { return this.store.getAccounts().find(a => a.id === id)?.name || id; }
  _log(id, level, code, params, message, alertType = null) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'Tower', code, params, message, alertType });
  }
  _row(id, patch) { Object.assign(this.run.accounts[id], patch); this.onChanged(); }
  _tower(id, modeId) { return this.run.accounts[id].towers.find(t => t.modeId === modeId); }

  stop(accountIds = null) {
    for (const [id, c] of this.controllers) if (!accountIds || accountIds.includes(id)) c.abort();
    return this.snapshot();
  }

  async runAndWait(accountIds, { signal } = {}) {
    if (this.controllers.size) throw new Error('Tower is already running.');
    const ids = accountIds.filter(id => this.store.getAccounts().some(a => a.id === id));
    if (!ids.length) throw new Error('Select at least one account.');
    this.run = { startedAt: new Date(this.now()).toISOString(), accounts: {} };
    for (const id of ids) {
      this.run.accounts[id] = { accountId: id, name: this._name(id), status: 'queued', message: null, tower: null, floor: null, towers: [], wins: 0, losses: 0 };
      const c = new AbortController();
      this.controllers.set(id, c);
      signal?.addEventListener('abort', () => c.abort(), { once: true });
    }
    this._log(null, 'info', 'tw.start', { count: ids.length }, `Tower started · ${ids.length} account(s)`);
    this.onChanged();
    try {
      await Promise.all(ids.map(id => this._account(id, this.controllers.get(id).signal)));
    } finally {
      this.store.saveTowerReport?.(this._report());
      this.controllers.clear();
      this.onChanged();
    }
    return this.snapshot();
  }

  _report() {
    const rows = Object.values(this.run.accounts);
    for (const r of rows) {
      const towers = r.towers.map(t => `${t.label} ${t.floor}${t.state === 'done' ? '✓' : ''} (${t.wins}W/${t.losses}L)`).join(' · ');
      this._log(r.accountId, r.status === 'done' ? 'success' : 'warning', 'tw.result', { status: r.status, wins: r.wins, losses: r.losses, towers }, `Tower result · ${r.status} · ${r.wins} win(s) · ${towers}`);
    }
    const wins = rows.reduce((n, r) => n + r.wins, 0);
    this._log(null, 'success', 'tw.summary', { count: rows.length, wins }, `Tower finished · ${rows.length} account(s) · ${wins} win(s)`);
    return { startedAt: this.run.startedAt, finishedAt: new Date(this.now()).toISOString(), rows: JSON.parse(JSON.stringify(rows)) };
  }

  // Tower data needs the session; a plain cookie connection is tried first, then a
  // registered one (Auto Play on the account is paused while Tower runs).
  async _towerData(conn, signal) {
    const read = (timeoutMs = 10000) => conn.main.call('towerChallenge:getTowerData', undefined, 'towerChallenge:towerData', { signal, timeoutMs });
    let r = await read(conn.registered ? 10000 : this.timing.cookieTryMs).catch(() => null);
    if (!r?.success && !conn.registered) {
      await conn.main.register(conn.userId, { signal, owner: 'Tower' });
      conn.registered = true;
      r = await read();
    }
    if (!r?.success) throw new Error(r?.message || 'Tower data could not be read.');
    return r.data;
  }

  _applyData(id, data, init = false) {
    const row = this.run.accounts[id];
    const modes = [...(data.modes || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const [i, m] of modes.entries()) {
      const p = data.userProgress?.[m.id] || {};
      let t = row.towers.find(x => x.modeId === m.id);
      if (!t) {
        t = { modeId: m.id, mode: m.name, label: (m.displayName || m.name).replace(/ Mode$/i, ''), order: i, floor: 1, startFloor: null, maxFloor: (data.floorsByMode?.[m.id] || []).length || 60, state: 'active', reason: null, wins: 0, losses: 0, streak: 0 };
        row.towers.push(t);
      }
      t.floor = Number(p.currentFloor) || 1;
      if (init) t.startFloor = t.floor;
      if (p.isCompleted || t.floor > t.maxFloor) { t.state = 'done'; t.reason = t.reason || 'completed'; }
    }
    this.onChanged();
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    const conn = { main: null, sim: null, userId: null, registered: false };
    let retry = false;
    try {
      if (this.gameHealth?.isDown()) { this._row(id, { status: 'waitingGame' }); await this.gameHealth.waitUp(signal); }
      this._row(id, { status: 'login' });
      const session = await this.sessions.get(account, { owner: 'tower' });
      conn.userId = session.userId;
      conn.main = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
      conn.sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: session.cookieHeader, signal });
      let data = await this._towerData(conn, signal);
      this._applyData(id, data, true);
      // Already in a match (Auto Play, PVP…): wait for it to end first.
      if (await this._active(conn, signal)) {
        this._row(id, { status: 'waitingMatch' });
        this._log(id, 'info', 'tw.waitMatch', {}, 'Already in a match · waiting for it to end');
        await this._waitEnd(id, conn, signal, null);
      }
      let startFailures = 0;
      for (;;) {
        const t = nextTower(this.run.accounts[id].towers);
        if (!t) break;
        const floor = (data.floorsByMode?.[t.modeId] || []).find(f => f.floorNumber === t.floor);
        if (!floor) { t.state = 'done'; t.reason = 'completed'; continue; }
        this._row(id, { status: 'starting', tower: t.label, floor: t.floor });
        const r = await conn.sim.ack('playTowerChallengeMatch', { userId: conn.userId, opponentId: floor.enemyUserId, floorNumber: t.floor, modeId: t.modeId, mode: t.mode }, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.message || r?.error || 'refused');
          if (/salary cap/i.test(msg)) throw new SalaryCapError(msg);
          if (/already|in a match|active match/i.test(msg)) { await this._waitEnd(id, conn, signal, null); continue; }
          startFailures++;
          this._log(id, 'warning', 'tw.startFailed', { tower: t.label, floor: t.floor, error: msg }, `${t.label} floor ${t.floor} could not start: ${msg}`);
          if (startFailures >= MAX_START_FAILURES) throw new Error(msg);
          await sleep(this.timing.pollMs, signal);
          continue;
        }
        startFailures = 0;
        const floorBefore = t.floor;
        this._row(id, { status: 'playing', tower: t.label, floor: t.floor });
        this._log(id, 'info', 'tw.matchStarted', { tower: t.label, floor: t.floor }, `${t.label} floor ${t.floor} started`);
        await this._waitEnd(id, conn, signal, r.matchId);
        data = await this._towerData(conn, signal);
        this._applyData(id, data);
        const row = this.run.accounts[id];
        if (t.floor > floorBefore || t.state === 'done') {
          t.wins++; t.streak = 0; row.wins++;
          this._log(id, 'success', 'tw.won', { tower: t.label, floor: floorBefore }, `${t.label} floor ${floorBefore} won`);
        } else {
          t.losses++; t.streak++; row.losses++;
          this._log(id, 'warning', 'tw.lost', { tower: t.label, floor: floorBefore, n: t.streak }, `${t.label} floor ${floorBefore} lost (${t.streak}/${MAX_LOSSES})`);
          if (t.streak >= MAX_LOSSES) {
            t.state = 'stopped'; t.reason = 'losses';
            this._log(id, 'warning', 'tw.towerStopped', { tower: t.label, floor: floorBefore }, `${t.label} given up at floor ${floorBefore} after ${MAX_LOSSES} losses in a row`);
          }
        }
        this.onChanged();
      }
      const all = this.run.accounts[id].towers;
      this._row(id, { status: all.every(t => t.state === 'done') ? 'done' : 'finished', tower: null, floor: null });
      this._log(id, 'success', 'tw.accountDone', {}, 'Tower finished for this account');
    } catch (error) {
      const row = this.run.accounts[id];
      const mark = reason => { for (const t of row.towers) if (t.state === 'active') { t.state = 'stopped'; t.reason = reason; } };
      if (error?.name === 'AbortError') { mark('user'); this._row(id, { status: 'stopped' }); this._log(id, 'warning', 'tw.stopped', {}, 'Tower stopped'); return; }
      if (error instanceof SalaryCapError) {
        mark('salary');
        this._row(id, { status: 'salaryCap', message: error.message });
        this._log(id, 'error', 'tw.salaryCap', { error: error.message }, `Tower stopped: ${error.message}`, 'salary-cap');
        return;
      }
      // The game is unreachable: wait for the shared check, then pick up from the game's floors.
      if (this.gameHealth && isNetError(error)) {
        this.gameHealth.reportDown('Tower', error);
        this._row(id, { status: 'waitingGame', message: error.message });
        retry = true;
        return;
      }
      if (/auth|session|login/i.test(error.message)) this.sessions.invalidate?.(id);
      mark('error');
      this._row(id, { status: 'error', message: error.message });
      this._log(id, 'error', 'tw.failed', { error: error.message }, `Tower stopped: ${error.message}`);
    } finally {
      try { conn.main?.close(); } catch {}
      try { conn.sim?.close(); } catch {}
      if (!retry) this.controllers.delete(id);
      this.onChanged();
      if (retry) await this._retryAfterOutage(id, signal);
    }
  }

  async _retryAfterOutage(id, signal) {
    try { await this.gameHealth.waitUp(signal); } catch { this._row(id, { status: 'stopped' }); this.controllers.delete(id); return; }
    await this._account(id, signal);
  }

  async _active(conn, signal) {
    return (await conn.sim.ack('getUserActiveMatch', { userId: conn.userId }, { signal, timeoutMs: 10000 }))?.match || null;
  }

  // Waits until the account has no running match. With `matchId`, waits first for that
  // match to show up (it can take a moment after the start).
  async _waitEnd(id, conn, signal, matchId) {
    const until = this.now() + this.timing.matchMaxMs;
    if (matchId) {
      const appear = this.now() + this.timing.appearGraceMs;
      while (!(await this._active(conn, signal)) && this.now() < appear) await sleep(this.timing.pollMs, signal);
    }
    while (await this._active(conn, signal)) {
      if (this.now() > until) throw new Error('The match did not end in time.');
      await sleep(this.timing.pollMs, signal);
    }
  }
}

module.exports = { TowerService, nextTower };
