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
  call(event, payload, replyEvent, { timeoutMs = DEFAULT_TIMEOUT_MS, signal = null, errorEvents = [] } = {}) {
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
  ack(event, payload, { timeoutMs = DEFAULT_TIMEOUT_MS, signal = null } = {}) {
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
  register(userId, { timeoutMs = 10000, signal = null } = {}) {
    return this.call('register', { userId }, 'registrationSuccess', { timeoutMs, signal });
  }

  close() { this.socket.close(); }
}

module.exports = { GameSocket, SOCKET_URL };
