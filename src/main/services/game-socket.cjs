const { io } = require('socket.io-client');

// The game's main socket (/socket/) answers most requests with a separate
// event instead of an ack, so one request is in flight at a time per socket:
// call() queues requests and resolves with the next matching reply event.
const SOCKET_URL = 'https://dreamteamph.com';
const DEFAULT_TIMEOUT_MS = 15000;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

class GameSocket {
  constructor(socket) {
    this.socket = socket;
    this.queue = Promise.resolve();
  }

  static open({ createSocket = (url, options) => io(url, options), path = '/socket/', cookie = null, signal = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const socket = createSocket(SOCKET_URL, {
        path, transports: ['websocket'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000,
        ...(cookie ? { withCredentials: true, extraHeaders: { Cookie: cookie } } : {})
      });
      const timer = setTimeout(() => finish(new Error('Game socket connection timed out.')), timeoutMs);
      const onConnect = () => finish();
      const onError = error => finish(new Error(`Game socket could not connect: ${error?.message || error}`));
      const onAbort = () => finish(abortError());
      function finish(error) {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
        signal?.removeEventListener('abort', onAbort);
        if (error) { socket.close(); reject(error); } else resolve(new GameSocket(socket));
      }
      socket.on('connect', onConnect);
      socket.on('connect_error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Emits `event` and resolves with the payload of the next `replyEvent`.
  // `errorEvents` are the game's error answers for it (e.g. "enhance:itemError"
  // carrying "Please wait…"); they resolve as { success: false, ...payload }.
  async call(event, payload, replyEvent, options = {}) {
    if (this.kicked) await this._reclaimOnce(options.signal);
    return this._call(event, payload, replyEvent, options);
  }

  _call(event, payload, replyEvent, { timeoutMs = DEFAULT_TIMEOUT_MS, signal = null, errorEvents = [] } = {}) {
    const run = () => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const timer = setTimeout(() => finish(new Error(`No reply to ${event}.`)), timeoutMs);
      const onReply = data => finish(null, data);
      const onErrors = errorEvents.map(name => [name, data => finish(null, { success: false, ...(data && typeof data === 'object' ? data : { error: String(data) }), errorEvent: name })]);
      const onDisconnect = () => finish(new Error('Game socket disconnected.'));
      const onAbort = () => finish(abortError());
      const socket = this.socket;
      function finish(error, data) {
        clearTimeout(timer);
        socket.off(replyEvent, onReply);
        for (const [name, fn] of onErrors) socket.off(name, fn);
        socket.off('disconnect', onDisconnect);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(data);
      }
      for (const [name, fn] of onErrors) socket.on(name, fn);
      socket.on(replyEvent, onReply);
      socket.on('disconnect', onDisconnect);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (payload === undefined) socket.emit(event); else socket.emit(event, payload);
    });
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  // For events the server answers with an ack (/simulation-socket/, daily tasks).
  async ack(event, payload, { timeoutMs = DEFAULT_TIMEOUT_MS, signal = null } = {}) {
    if (this.kicked) await this._reclaimOnce(signal);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const onAbort = () => reject(abortError());
      signal?.addEventListener('abort', onAbort, { once: true });
      this.socket.timeout(timeoutMs).emit(event, payload, (error, data) => {
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(new Error(`No reply to ${event}.`)); else resolve(data);
      });
    });
  }

  // Writes on /socket/ (market remove/sell/claim) are tied to the user the
  // socket registered as; the session cookie alone answers "Authentication
  // required". Like the game page, this kicks an older /socket/ session of
  // the same account (it gets "duplicateLogin").
  // `owner` names the service (Market, Auto Buy…) for the kick report.
  async register(userId, { timeoutMs = 10000, signal = null, owner = null } = {}) {
    this.userId = userId;
    if (owner) this.owner = owner;
    this._watchKicks();
    registrants.set(String(userId), { owner: this.owner || 'App', gs: this, at: Date.now() });
    const reply = await this._call('register', { userId }, 'registrationSuccess', { timeoutMs, signal });
    this.kicked = null;
    return reply;
  }

  // "duplicateLogin": another session registered the same account and this one no
  // longer gets answers. The kick is reported once; the next request signs in again.
  _watchKicks() {
    if (this._kickWatch) return;
    this._kickWatch = message => {
      if (this.closed) return;
      const last = registrants.get(String(this.userId));
      const by = last && last.gs !== this ? last.owner : null; // null: the game itself (a browser tab)
      this.kicked = { at: Date.now(), by };
      const key = `${this.userId}|${this.owner || 'App'}`;
      const recent = (kickTimes.get(key) || []).filter(t => Date.now() - t < KICK_WINDOW_MS);
      recent.push(Date.now());
      kickTimes.set(key, recent);
      kickListener?.({ userId: this.userId, owner: this.owner || 'App', by, count: recent.length, message: message?.message || message || null });
    };
    this.socket.on('duplicateLogin', this._kickWatch);
  }

  // Concurrent requests after a kick share one sign-in.
  _reclaimOnce(signal) {
    this._reclaiming ||= this._reclaim(signal).finally(() => { this._reclaiming = null; });
    return this._reclaiming;
  }

  // Signs in again after a kick. Two services that keep taking the same account
  // from each other would kick each other forever, so repeated kicks wait longer
  // each time and, past a limit, this service stops taking the account back.
  async _reclaim(signal) {
    const kick = this.kicked;
    const key = `${this.userId}|${this.owner || 'App'}`;
    const count = (kickTimes.get(key) || []).filter(t => Date.now() - t < KICK_WINDOW_MS).length;
    if (count > KICK_GIVE_UP) {
      const error = new Error(`Signed in elsewhere${kick?.by ? ` by ${kick.by}` : ''} ${count} times in a few minutes; not signing in again to avoid a loop.`);
      error.code = 'KICK_LOOP';
      kickListener?.({ userId: this.userId, owner: this.owner || 'App', by: kick?.by || null, count, gaveUp: true });
      throw error;
    }
    if (count >= KICK_SLOW_AFTER) {
      const waitMs = Math.min(KICK_MAX_WAIT_MS, KICK_BASE_WAIT_MS * 2 ** (count - KICK_SLOW_AFTER));
      kickListener?.({ userId: this.userId, owner: this.owner || 'App', by: kick?.by || null, count, waitMs, slowed: true });
      await delay(waitMs, signal);
    }
    if (!this.socket.connected) {
      const socket = this.socket;
      await new Promise((resolve, reject) => {
        const ok = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { socket.off('connect', ok); reject(new Error('Game socket connection timed out.')); }, DEFAULT_TIMEOUT_MS);
        socket.once('connect', ok);
        socket.connect();
      });
    }
    await this.register(this.userId, { signal });
  }

  // Seconds until this account may make its next market action (0 = now), read the
  // way the game's market pages do; null when the game does not answer.
  async marketCooldown({ signal = null, timeoutMs = 3000 } = {}) {
    const r = await this.call('market:checkCooldown', undefined, 'market:cooldownStatus', { signal, timeoutMs })
      .catch(error => { if (error?.name === 'AbortError') throw error; return null; });
    if (!r) return null;
    const left = Number(r.remainingTime) || 0;
    if (!r.onCooldown || left <= 0) return 0;
    return left > 600 ? left / 1000 : left; // the page counts it down in seconds
  }

  close() { this.closed = true; this.socket.close(); }
}

// Shared by every connection of the app: who signed each account in last.
const registrants = new Map(); // userId -> { owner, gs, at }
const kickTimes = new Map();   // `${userId}|${owner}` -> kick timestamps
const KICK_WINDOW_MS = 10 * 60 * 1000;
const KICK_SLOW_AFTER = 3;     // from the 3rd kick in 10 min, wait before signing in again
const KICK_GIVE_UP = 5;        // after the 5th, stop taking the account back
const KICK_BASE_WAIT_MS = 15000;
const KICK_MAX_WAIT_MS = 60000;
let kickListener = null;

function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// `fn({ userId, owner, by, count, waitMs?, slowed? })` hears every kick (main.cjs logs it).
GameSocket.onKick = fn => { kickListener = fn; };
GameSocket._resetKicks = () => { registrants.clear(); kickTimes.clear(); };

module.exports = { GameSocket, SOCKET_URL };
