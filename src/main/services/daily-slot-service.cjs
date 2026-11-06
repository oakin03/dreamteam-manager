const { GameSocket } = require('./game-socket.cjs');

// Daily Slot (Daily Sign-in window → "Daily Slot" tab; user 2026-11-07, captured live on Pipelne19):
//   dailySlot:getStatus {userId} -> event dailySlot:status {dayKey, canSpin, pool[16]{name, rarity, chancePct…},
//     todaySpin: null | {results[3]{name, icon, rarity, type, itemId}, createdAt}}
//     — works on an anonymous socket, so reading never signs anybody out;
//   dailySlot:spin {} -> event dailySlot:spinResult {dayKey, results[3], rewards[], message}
//     — no userId: the server takes the account from a `register`ed socket. The "skip animation"
//     button is only the page's; the result comes at once.
// One spin a day (the game's day, dayKey). Spinning uses the account's own registered connection when
// another service holds one (Auto Play…), never during one of its matches; otherwise it signs in.
const CONCURRENCY = 4;
const TIMEOUT_MS = 12000;
const MATCH_WAIT_MS = 60 * 1000;
const MATCH_PASSES = 15;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', on); resolve(); }, ms);
    const on = () => { clearTimeout(t); reject(abortError()); };
    signal?.addEventListener('abort', on, { once: true });
  });
}
const prizes = list => (list || []).map(r => ({ name: r.name || r.item?.name || '?', rarity: r.rarity || null, icon: r.icon || r.item?.icon || null, type: r.type || null }));

class DailySlotService {
  constructor({ store, activity, sessions, engine = null, gameHealth = null, createSocket, onChanged, now = () => Date.now() }) {
    Object.assign(this, { store, activity, sessions, engine, gameHealth, createSocket, now });
    this.onChanged = onChanged || (() => {});
    this.controller = null;
    const saved = this.store.getSettings?.()?.dailySlot;
    this.rows = saved?.rows || {};   // accountId -> { dayKey, canSpin, results, spunAt, status, error, at }
    this.lastRun = saved?.lastRun || null;
  }

  snapshot() { return { running: Boolean(this.controller), rows: JSON.parse(JSON.stringify(this.rows)), lastRun: this.lastRun, pool: this.pool || null }; }
  stop() { this.controller?.abort(); }
  _accounts() { return this.store.getAccounts?.() || []; }
  _name(id) { return this._accounts().find(a => a.id === id)?.name || id; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) { this.activity?.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'Daily Slot', code: `ds.${code}`, params, message }); }
  _set(id, patch) { this.rows[id] = { ...(this.rows[id] || {}), ...patch, at: new Date(this.now()).toISOString() }; this.onChanged(); }
  _save() { const s = this.store.getSettings?.() || {}; this.store.saveSettings?.({ ...s, dailySlot: { rows: this.rows, lastRun: this.lastRun } }); }
  async _each(ids, fn) { for (let i = 0; i < ids.length; i += CONCURRENCY) await Promise.all(ids.slice(i, i + CONCURRENCY).map(fn)); }

  async _status(gs, userId, signal) {
    const r = await gs.call('dailySlot:getStatus', { userId }, 'dailySlot:status', { signal, timeoutMs: TIMEOUT_MS });
    if (!r || !('canSpin' in r)) throw new Error(r?.error || r?.message || 'The Daily Slot could not be read.');
    if (Array.isArray(r.pool) && r.pool.length) this.pool = r.pool.map(p => ({ name: p.name, rarity: p.rarity, chancePct: p.chancePct }));
    return r;
  }

  // Reads every account (no sign-in): spun or not, and today's three prizes when spun.
  async scan(accountIds) {
    return this._run(accountIds, false);
  }

  // Spins every account that has not spun today; the others show what they won.
  async spin(accountIds) {
    return this._run(accountIds, true);
  }

  async _run(accountIds, doSpin) {
    if (this.controller) throw new Error('Daily Slot is already running.');
    const ids = (accountIds || []).filter(id => this._accounts().some(a => a.id === id));
    if (!ids.length) throw new Error('Select at least one account.');
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const run = { kind: doSpin ? 'spin' : 'scan', startedAt: new Date(this.now()).toISOString(), total: ids.length, spun: 0, already: 0, failed: 0 };
    this.lastRun = run;
    for (const id of ids) this._set(id, { status: 'queued', error: null });
    if (doSpin) this._log(null, 'info', 'start', { n: ids.length }, `Daily Slot started · ${ids.length} account(s)`);
    let anon = null;
    try {
      if (this.gameHealth?.isDown?.()) await this.gameHealth.waitUp(signal);
      anon = await GameSocket.open({ createSocket: this.createSocket, signal });
      let later = [];
      await this._each(ids, async id => {
        const r = await this._one(id, anon, doSpin, signal).catch(error => { if (error?.name === 'AbortError') throw error; return { error }; });
        if (r?.later) later.push(id);
        this._tally(run, r);
      });
      // accounts that were in a match: tried again every minute (at most ~15 minutes)
      for (let pass = 0; later.length && pass < MATCH_PASSES; pass++) {
        await sleep(MATCH_WAIT_MS, signal);
        const again = later; later = [];
        await this._each(again, async id => {
          const r = await this._one(id, anon, doSpin, signal).catch(error => { if (error?.name === 'AbortError') throw error; return { error }; });
          if (r?.later) later.push(id); else this._tally(run, r);
        });
      }
      for (const id of later) { this._set(id, { status: 'error', error: 'inMatch' }); run.failed++; }
      run.finishedAt = new Date(this.now()).toISOString();
      if (doSpin) this._log(null, run.failed ? 'warning' : 'success', 'done', { spun: run.spun, already: run.already, failed: run.failed }, `Daily Slot finished · ${run.spun} spun · ${run.already} had already spun · ${run.failed} failed`);
    } catch (error) {
      run.finishedAt = new Date(this.now()).toISOString();
      run.error = error?.name === 'AbortError' ? 'stopped' : error.message;
      for (const id of ids) if (['queued', 'reading', 'spinning', 'waitMatch'].includes(this.rows[id]?.status)) this._set(id, { status: error?.name === 'AbortError' ? 'stopped' : 'error' });
      if (error?.name !== 'AbortError') this._log(null, 'error', 'failed', { error: error.message }, `Daily Slot stopped: ${error.message}`);
    } finally {
      try { anon?.close(); } catch {}
      this.controller = null;
      this._save();
      this.onChanged();
    }
    return this.snapshot();
  }

  _tally(run, r) {
    if (!r || r.later) return;
    if (r.error) run.failed++;
    else if (r.spun) run.spun++;
    else if (r.already) run.already++;
  }

  async _one(id, anon, doSpin, signal) {
    const userId = this._userId(id);
    if (!userId) { this._set(id, { status: 'error', error: 'noUserId' }); return { error: new Error('noUserId') }; }
    this._set(id, { status: 'reading' });
    const st = await this._status(anon, userId, signal);
    if (!st.canSpin) {
      this._set(id, { status: 'spun', dayKey: st.dayKey, canSpin: false, results: prizes(st.todaySpin?.results), spunAt: st.todaySpin?.createdAt || null, error: null });
      return { already: true };
    }
    if (!doSpin) { this._set(id, { status: 'ready', dayKey: st.dayKey, canSpin: true, results: [], spunAt: null, error: null }); return { ready: true }; }
    // spin on the account's registered connection: another service's, or our own sign-in
    const account = this._accounts().find(a => a.id === id);
    const borrowed = GameSocket.borrow?.(userId);
    let own = null;
    try {
      if (!borrowed && this._playing(id) && await this._inMatch(userId, signal)) { this._set(id, { status: 'waitMatch' }); return { later: true }; }
      this._set(id, { status: 'spinning' });
      let gs = borrowed;
      if (!gs) {
        const { cookieHeader: cookie } = await this.sessions.get(account, { owner: 'daily-slot' });
        own = await GameSocket.open({ createSocket: this.createSocket, cookie, signal });
        await own.register(userId, { signal, owner: 'Daily Slot' });
        gs = own;
      }
      const r = await gs.call('dailySlot:spin', {}, 'dailySlot:spinResult', { signal, timeoutMs: TIMEOUT_MS });
      const results = prizes(r?.results);
      if (!results.length) {
        // no result: read again (the spin may have gone through)
        const again = await this._status(anon, userId, signal).catch(() => null);
        if (again && !again.canSpin) { this._set(id, { status: 'spun', canSpin: false, results: prizes(again.todaySpin?.results), spunAt: again.todaySpin?.createdAt || null, error: null }); return { spun: true }; }
        throw new Error(r?.error || r?.message || 'The spin got no answer.');
      }
      this._set(id, { status: 'spun', dayKey: r.dayKey || st.dayKey, canSpin: false, results, spunAt: new Date(this.now()).toISOString(), error: null, justSpun: true });
      this._log(id, 'success', 'spun', { prizes: results.map(p => p.name).join(', ') }, `Daily Slot · ${results.map(p => p.name).join(', ')}`);
      return { spun: true };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      this._set(id, { status: 'error', error: error.message });
      this._log(id, 'warning', 'spinFailed', { error: error.message }, `Daily Slot could not be spun: ${error.message}`);
      return { error };
    } finally {
      try { own?.close(); } catch {}
    }
  }

  _playing(id) { return this.engine?.states?.()?.[id]?.status === 'running'; }
  async _inMatch(userId, signal) {
    let sim = null;
    try {
      sim = await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/', signal, timeoutMs: 10000 });
      const r = await sim.ack('getUserActiveMatch', { userId }, { signal, timeoutMs: 8000 });
      return Boolean(r?.match);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return false;
    } finally { try { sim?.close(); } catch {} }
  }
}

module.exports = { DailySlotService };
