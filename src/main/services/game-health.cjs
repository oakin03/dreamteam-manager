const { GameSocket } = require('./game-socket.cjs');

// One shared "is the game reachable?" state for every automation. When a service sees
// a connection error it reports it here; from then on ONE anonymous connection probes
// the game every 2 minutes while the services wait (instead of every account retrying
// on its own every few seconds). When the probe connects, everybody continues.
// Seen 2026-10-23 04:00–04:04 TR: the whole game was unreachable for a few minutes.
const PROBE_MS = 2 * 60 * 1000;

const NET_ERROR = /could not connect|websocket error|socket disconnected|disconnected|connection timed out|xhr poll|transport (close|error)|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network/i;
function isNetError(error) { return NET_ERROR.test(String(error?.message || error || '')); }

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

class GameHealth {
  constructor({ activity, onChanged, createSocket, now = () => Date.now(), probeMs = PROBE_MS } = {}) {
    Object.assign(this, { activity, onChanged, createSocket, now, probeMs });
    this.down = false;
    this.downSince = null;
    this.lastError = null;
    this.waiters = new Set();
    this.timer = null;
  }

  snapshot() { return { down: this.down, downSince: this.downSince, lastError: this.lastError, nextProbeAt: this.nextProbeAt || null }; }
  isDown() { return this.down; }

  // A service saw a connection problem. Only the first report starts the probing.
  reportDown(source, error) {
    if (this.down) return;
    this.down = true;
    this.downSince = new Date(this.now()).toISOString();
    this.lastError = String(error?.message || error || '');
    this.activity?.add({ level: 'warning', accountId: null, accountName: '', taskName: 'Game', code: 'gh.down', params: { source, error: this.lastError }, message: `The game is not reachable (${source}: ${this.lastError}) · checking every 2 minutes with one connection` });
    this.onChanged?.();
    this._schedule();
  }

  _schedule() {
    clearTimeout(this.timer);
    this.nextProbeAt = new Date(this.now() + this.probeMs).toISOString();
    this.timer = setTimeout(() => this._probe(), this.probeMs);
    this.timer.unref?.();
  }

  async _probe() {
    let ok = false;
    try {
      const conn = await GameSocket.open({ createSocket: this.createSocket, timeoutMs: 15000 });
      try { ok = Boolean(await conn.call('getServerTime', undefined, 'serverTime', { timeoutMs: 10000 }).then(() => true, () => true)); } finally { conn.close(); }
    } catch { ok = false; }
    if (!ok) { this._schedule(); this.onChanged?.(); return; }
    const minutes = Math.max(1, Math.round((this.now() - Date.parse(this.downSince)) / 60000));
    this.down = false;
    this.downSince = null;
    this.nextProbeAt = null;
    this.activity?.add({ level: 'success', accountId: null, accountName: '', taskName: 'Game', code: 'gh.up', params: { minutes }, message: `The game is reachable again (after ~${minutes} min) · automations continue` });
    for (const w of this.waiters) w();
    this.waiters.clear();
    this.onChanged?.();
  }

  // Resolves at once when the game is up, otherwise when the probe gets through.
  waitUp(signal) {
    if (!this.down) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const done = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
      const onAbort = () => { this.waiters.delete(done); reject(abortError()); };
      this.waiters.add(done);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  shutdown() { clearTimeout(this.timer); }
}

module.exports = { GameHealth, isNetError };
