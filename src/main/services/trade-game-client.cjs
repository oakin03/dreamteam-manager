const { GameSocket } = require('./game-socket.cjs');

// One account's registered /socket/ connection for Auto Trade: Scout, roster, Make,
// market listing and the Trade Center. Reads also work unregistered, writes need
// `register` (which signs that account out of an open game tab).
const TIMEOUT_MS = 20000;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
const waitOf = r => r?.retryAfter ?? Number(String(r?.message || r?.error || '').match(/please wait (\d+)/i)?.[1]);

class TradeGameAccount {
  constructor({ account, userId, conn, signal }) {
    this.account = account;
    this.userId = userId;
    this.conn = conn;
    this.signal = signal;
  }

  static async open({ account, sessions, createSocket, signal }) {
    const session = await sessions.get(account, { owner: 'auto-trade' });
    const conn = await GameSocket.open({ createSocket, cookie: session.cookieHeader, signal });
    try {
      await conn.register(session.userId, { signal });
    } catch (error) { conn.close(); throw error; }
    return new TradeGameAccount({ account, userId: session.userId, conn, signal });
  }

  get socket() { return this.conn.socket; }
  close() { try { this.conn.close(); } catch {} }

  async _ack(event, payload, { retries = 4 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const r = await this.conn.ack(event, payload, { signal: this.signal, timeoutMs: TIMEOUT_MS });
      const wait = waitOf(r);
      if (r?.success === false && Number.isFinite(wait) && attempt < retries) { await sleep(wait * 1000 + 250, this.signal); continue; }
      return r;
    }
  }

  roster() { return this._ack('getTeamOptimized', { userId: this.userId }); }
  freeAgents() { return this._ack('getFreeAgent', { userId: this.userId }); }
  sign(playerId) { return this._ack('signFreeAgent', { userId: this.userId, playerId }); }
  async callback() {
    const attempts = await this._ack('getFreeAgentAttempts', { userId: this.userId });
    if (!attempts?.hasAttempts || !(attempts.attemptsLeft > 0)) return { success: false, noAttempts: true, attempts };
    return this._ack('CallBackFreeAgent', { userId: this.userId });
  }
  bench() { return this._ack('starcard:getUserBench', { userId: this.userId }); }
  makeCards(playerIds) { return this._ack('starcard:makeStarCards', { userId: this.userId, playerIds }); }

  async funds() {
    const info = await this.conn.call('getUserBasicInfo', { userId: this.userId }, 'userBasicInfo', { signal: this.signal, timeoutMs: TIMEOUT_MS });
    return Number(info?.funds);
  }

  async sell(playerId, price, currency) {
    const paymentMode = currency === 'TIX' ? 'TICKET' : 'APK_TICKET';
    for (let attempt = 0; ; attempt++) {
      const r = await this.conn.call('market:sellPlayer', { userId: this.userId, playerId, price: Number(price), paymentMode }, 'market:sellResult', { signal: this.signal, timeoutMs: TIMEOUT_MS });
      const wait = waitOf(r);
      if (r?.success === false && Number.isFinite(wait) && attempt < 4) { await sleep(wait * 1000 + 250, this.signal); continue; }
      return r;
    }
  }

  // Resolves with the first `event` payload that matches; listen BEFORE emitting.
  expect(event, match = () => true, timeoutMs = TIMEOUT_MS) {
    const socket = this.socket;
    const signal = this.signal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error(`No ${event} from the game.`)), timeoutMs);
      const onEvent = data => { if (match(data)) done(null, data); };
      const onAbort = () => done(abortError());
      function done(error, data) {
        clearTimeout(timer);
        socket.off(event, onEvent);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(data);
      }
      socket.on(event, onEvent);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  emit(event, payload) { this.socket.emit(event, payload); }

  // Host: create a password-protected room and learn its id from the room list.
  async createRoom(description, password) {
    this.emit('joinTradeRoomBroadcast', { userId: this.userId });
    const listed = this.expect('tradeRoomList', d => (d?.rooms || []).some(r => r.hostId === this.userId && !r.guestId));
    this.emit('createTradeRoom', { description: String(description), password: String(password || '') });
    await sleep(400, this.signal);
    this.emit('getTradeRooms');
    const list = await listed;
    const mine = list.rooms.filter(r => r.hostId === this.userId && !r.guestId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    return mine.roomId;
  }

  // Guest: join with the password; resolves with joinedRoomData (both player lists).
  async joinRoom(roomId, password) {
    const joined = this.expect('joinedRoomData', d => d?.roomId === roomId);
    const refused = this.expect('joinRoomError', () => true).then(d => { throw new Error(d?.message || 'Could not join the trade room.'); }, () => new Promise(() => {}));
    this.emit('joinTradeRoom', { roomId, password: String(password || '') });
    return Promise.race([joined, refused]);
  }

  select(roomId, players) { this.emit('selectTradePlayers', { roomId, userId: this.userId, selected: players, resetAcceptances: true }); }
  accept(roomId) { this.emit('acceptTrade', { roomId, userId: this.userId, accepted: true }); }
  confirm(roomId, hostSelected, guestSelected) { this.emit('confirmTrade', { roomId, hostSelected, guestSelected }); }
  cancelRoom(roomId) { try { this.emit('cancelTradeRoom', { roomId }); this.emit('leaveTradeRoomBroadcast', { userId: this.userId }); } catch {} }
  leave() { try { this.emit('leaveTradeRoomBroadcast', { userId: this.userId }); } catch {} }
}

module.exports = { TradeGameAccount, sleep, abortError };
