const { GameSocket } = require('./game-socket.cjs');

// Live Draft over the game's /draft-socket/. Room states and attempts are read
// without logging in; joining and picking use the account's session cookie (no
// `register`, so an open game tab stays signed in). The user picks; the app shows
// the pool, whose turn it is, and keeps the drafted players for market listing.
const PATH = '/draft-socket/';
// Normal draft rooms by slot number (verified against the Draft Hall screen).
const SLOT_LEVELS = { 3: [1, 20], 4: [1, 20], 5: [21, 30], 6: [21, 30], 7: [21, 30], 8: [31, 50], 9: [31, 50], 10: [51, 70], 11: [51, 70], 12: [71, 100] };
const ROOM_SIZE = 10;
const POLL_MS = 2000;

function levelRange(slot) { return SLOT_LEVELS[slot] || null; }

// Rooms an account may join right now (like the game's Draft Hall).
function joinableSlots(slots, level, { attempts = 0, busy = false } = {}) {
  if (busy || !(attempts > 0) || !Number.isFinite(Number(level))) return [];
  return (slots || []).filter(s => {
    const r = levelRange(s.slotNumber);
    return r && level >= r[0] && level <= r[1] && !s.hasStarted && !(s.cooldownRemaining > 0) && (s.users?.length || 0) < ROOM_SIZE;
  }).map(s => s.slotNumber);
}

class DraftService {
  constructor({ store, activity, sessions, accountProfile, onChanged, onAttention, createSocket, now = () => Date.now() }) {
    this.store = store;
    this.activity = activity;
    this.sessions = sessions;
    this.accountProfile = accountProfile;
    this.onAttention = onAttention;
    this.createSocket = createSocket;
    this.now = now;
    this.revision = 0;
    this.onChanged = () => { this.revision++; onChanged?.(); };
    this.watchers = 0;
    this.anon = null;
    this.poll = null;
    this.slots = [];
    this.slotsAt = null;
    this.attempts = {};          // accountId -> { draftAttempts, rookieDraftAttempts, at }
    this.joined = new Map();     // accountId -> { conn, slot, userId }
    this.rooms = new Map();      // slot -> live room state
    this.error = null;
  }

  _accounts() { return this.store.getAccounts(); }
  _name(id) { return this._accounts().find(a => a.id === id)?.name || id; }
  _profile(id) { return this.store.getAccountProfile?.()?.accounts?.[id] || {}; }
  _userId(id) { return this._profile(id).userId || null; }
  _level(id) { return Number(this._profile(id).level) || null; }
  _log(level, code, params, message, accountId = null) {
    this.activity.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName: 'Draft', code, params, message });
  }

  _drafted() { return this.store.getDraftData()?.drafted || {}; }
  _saveDrafted(drafted) { this.store.saveDraftData({ ...(this.store.getDraftData() || {}), drafted }); }

  snapshot() {
    const accounts = this._accounts().map(a => {
      const att = this.attempts[a.id] || null;
      const j = this.joined.get(a.id);
      const level = this._level(a.id);
      // Also in a room the user joined in the game itself: a new draft waits until it ends.
      const userId = this._userId(a.id);
      const inGame = this.slots.find(s => (s.users || []).includes(userId))?.slotNumber ?? null;
      const inSlot = j?.slot ?? inGame;
      return {
        id: a.id, name: a.name, level, userId, attempts: att?.draftAttempts ?? null,
        inSlot, inSlotFromGame: !j && inGame != null,
        joinable: joinableSlots(this.slots, level, { attempts: att?.draftAttempts ?? 0, busy: inSlot != null })
      };
    });
    const rooms = [...this.rooms.values()].map(r => ({ ...r, ours: r.ours.map(id => ({ id, name: this._name(id), userId: this.joined.get(id)?.userId || this._userId(id) })) }));
    return {
      watching: this.watchers > 0, slotsAt: this.slotsAt, error: this.error,
      slots: this.slots.map(s => ({ slotNumber: s.slotNumber, range: levelRange(s.slotNumber), users: s.users?.length || 0, hasStarted: s.hasStarted, cooldownRemaining: s.cooldownRemaining || 0, countdown: s.countdown })),
      accounts, rooms, drafted: this._drafted()
    };
  }

  // The Draft page is open: poll the hall (and attempts) every 2 s.
  async watch() {
    this.watchers += 1;
    if (this.watchers === 1) {
      await this._refreshAttempts().catch(() => {});
      const tick = async () => {
        try { await this._readSlots(); this.error = null; } catch (error) { this.error = error.message; }
        this.onChanged();
        if (this.watchers > 0 || this.joined.size) this.poll = setTimeout(tick, POLL_MS);
      };
      tick();
    }
    return this.snapshot();
  }

  unwatch() {
    this.watchers = Math.max(0, this.watchers - 1);
    if (!this.watchers && !this.joined.size) this._stopPolling();
    return true;
  }

  _stopPolling() {
    clearTimeout(this.poll); this.poll = null;
    try { this.anon?.close(); } catch {}
    this.anon = null;
  }

  async _anon() {
    if (this.anon?.socket?.connected) return this.anon;
    try { this.anon?.close(); } catch {}
    this.anon = await GameSocket.open({ createSocket: this.createSocket, path: PATH });
    return this.anon;
  }

  async _readSlots() {
    const anon = await this._anon();
    const slots = await anon.call('getLiveDraftStatus', undefined, 'liveDraftStatus', { timeoutMs: 8000 });
    if (Array.isArray(slots)) { this.slots = slots; this.slotsAt = new Date(this.now()).toISOString(); }
  }

  // Attempts are always re-read from the game (they sometimes don't drop), never counted locally.
  async _refreshAttempts(ids = this._accounts().map(a => a.id)) {
    const anon = await this._anon();
    for (const id of ids) {
      const userId = this._userId(id);
      if (!userId) continue;
      const r = await anon.ack('getDraftAttempts', { userId }, { timeoutMs: 8000 }).catch(() => null);
      if (r?.success) this.attempts[id] = { draftAttempts: r.draftAttempts, rookieDraftAttempts: r.rookieDraftAttempts, at: new Date(this.now()).toISOString() };
    }
    this.onChanged();
  }

  async join(accountId, slotNumber) {
    if (this.joined.has(accountId)) throw new Error('This account is already in a draft.');
    const account = this._accounts().find(a => a.id === accountId);
    if (!account) throw new Error('Account not found.');
    await this._readSlots();
    await this._refreshAttempts([accountId]);
    const level = this._level(accountId);
    const busy = this.slots.some(s => (s.users || []).includes(this._userId(accountId)));
    if (!joinableSlots(this.slots, level, { attempts: this.attempts[accountId]?.draftAttempts ?? 0, busy }).includes(Number(slotNumber))) throw new Error('This room cannot be joined by this account now.');
    const session = await this.sessions.get(account, { owner: 'draft' });
    const conn = await GameSocket.open({ createSocket: this.createSocket, path: PATH, cookie: session.cookieHeader });
    const entry = { conn, slot: Number(slotNumber), userId: session.userId };
    this.joined.set(accountId, entry);
    this._listen(accountId, entry);
    const joined = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The game did not confirm joining the room.')), 15000);
      conn.socket.once('draftJoined', d => { clearTimeout(timer); resolve(d); });
    });
    conn.socket.emit('joinDraftSlot', { userId: session.userId, slotNumber: Number(slotNumber), draftType: 'CURRENT' });
    try {
      await joined;
    } catch (error) {
      this._leave(accountId);
      throw error;
    }
    this._log('success', 'df.joined', { slot: slotNumber }, `Joined draft room ${slotNumber}`, accountId);
    if (!this.poll) this.watch().then(() => this.unwatch());
    this.onChanged();
    return this.snapshot();
  }

  _room(slot) {
    if (!this.rooms.has(slot)) this.rooms.set(slot, { slot, range: levelRange(slot), players: [], users: [], countdown: null, started: false, pickOrder: [], pickIndex: 0, turn: null, ours: [], ended: false, joinedAt: new Date(this.now()).toISOString() });
    return this.rooms.get(slot);
  }

  _listen(accountId, entry) {
    const s = entry.conn.socket;
    const room = () => this._room(entry.slot);
    const touch = () => this.onChanged();
    const r = room();
    if (!r.ours.includes(accountId)) r.ours.push(accountId);
    s.on('draftJoined', d => { room().players = d.players || []; touch(); });
    s.on('draftPlayersUpdate', d => { room().players = d || room().players; touch(); });
    s.on('draftUsersUpdate', d => { room().users = d || []; touch(); });
    s.on('draftCountdown', d => { room().countdown = Number(d); room().countdownAt = new Date(this.now()).toISOString(); touch(); });
    s.on('draftState', d => { Object.assign(room(), { started: Boolean(d?.hasStarted), pickOrder: d?.pickOrder || room().pickOrder, pickIndex: d?.currentPickIndex ?? room().pickIndex }); touch(); });
    s.on('draftStart', d => { Object.assign(room(), { started: true, pickOrder: d?.pickOrder || [] }); this._log('info', 'df.started', { slot: entry.slot, count: (d?.pickOrder || []).length }, `Draft ${entry.slot} started`, accountId); touch(); });
    s.on('draftPickTimer', d => {
      const rm = room();
      const before = rm.turn?.userId;
      rm.turn = { index: d?.index, seconds: d?.seconds, userId: d?.userId, at: new Date(this.now()).toISOString() };
      rm.pickIndex = d?.index ?? rm.pickIndex;
      // Our account's turn: bring the app forward once per turn.
      const mine = rm.ours.find(id => this.joined.get(id)?.userId === d?.userId);
      if (mine && before !== d?.userId) this.onAttention?.('draftTurn', this._name(mine));
      touch();
    });
    s.on('draftEnded', () => this._ended(entry.slot));
    s.on('disconnect', () => touch());
  }

  async pick(accountId, playerId) {
    const entry = this.joined.get(accountId);
    if (!entry) throw new Error('This account is not in a draft.');
    const room = this._room(entry.slot);
    const player = room.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not in this draft.');
    if (player.signed) throw new Error('This player was already picked.');
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No answer to the pick.')), 15000);
      entry.conn.socket.once('signDraftPlayerResponse', d => { clearTimeout(timer); resolve(d); });
    });
    entry.conn.socket.emit('signDraftPlayer', { userId: entry.userId, playerId, slotNumber: entry.slot, draftType: 'CURRENT' });
    const r = await reply;
    if (!r?.success) {
      this._log('warning', 'df.pickFailed', { player: player.name, error: r?.message || '' }, `Pick failed: ${r?.message || ''}`, accountId);
      throw new Error(r?.message || 'Pick refused.');
    }
    const drafted = this._drafted();
    drafted[accountId] = [...(drafted[accountId] || []), { id: player.id, name: player.visualName || player.name, rating: player.rating, position: player.position, value: player.baseSalary, base: player.newBaseSalary, slot: entry.slot, at: new Date(this.now()).toISOString(), listed: false }];
    this._saveDrafted(drafted);
    this._log('success', 'df.picked', { player: player.name, slot: entry.slot }, `Picked ${player.name} in draft ${entry.slot}`, accountId);
    this.onChanged();
    this._readSalary(accountId, entry.userId, player.id).catch(() => {});
    return this.snapshot();
  }

  // The salary actually signed (Lv30+ accounts may get a 5% discount) is only on the
  // roster; read it without logging in.
  async _readSalary(accountId, userId, playerId) {
    const conn = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const r = await conn.ack('getTeamOptimized', { userId }, { timeoutMs: 10000 });
      const all = [...(r?.players?.starters || []), ...(r?.players?.bench || [])];
      const p = all.find(x => (x.id || x.playerId) === playerId);
      if (p?.signedSalary == null) return;
      const drafted = this._drafted();
      const row = (drafted[accountId] || []).find(x => x.id === playerId);
      if (!row) return;
      row.salary = Number(p.signedSalary);
      this._saveDrafted(drafted);
      this.onChanged();
    } finally { try { conn.close(); } catch {} }
  }

  async _ended(slot) {
    const room = this.rooms.get(slot);
    if (!room || room.ended) return;
    room.ended = true;
    this._log('info', 'df.ended', { slot }, `Draft ${slot} ended`);
    const ids = [...room.ours];
    for (const id of ids) this._leave(id);
    this.onChanged();
    // The draft is over for everyone: only now read the attempts again.
    await this._refreshAttempts(ids).catch(() => {});
    setTimeout(() => { if (this.rooms.get(slot) === room) { this.rooms.delete(slot); this.onChanged(); } }, 60000).unref?.();
  }

  _leave(accountId) {
    const entry = this.joined.get(accountId);
    if (!entry) return;
    try { entry.conn.close(); } catch {}
    this.joined.delete(accountId);
    if (!this.watchers && !this.joined.size) this._stopPolling();
  }

  // Drafted players → market (Auto Trade style), with the account's registered /socket/.
  async listPlayers(accountId, items) {
    const account = this._accounts().find(a => a.id === accountId);
    if (!account) throw new Error('Account not found.');
    const session = await this.sessions.get(account, { owner: 'draft' });
    const conn = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader });
    const drafted = this._drafted();
    try {
      await conn.register(session.userId);
      for (const it of items) {
        let r = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          r = await conn.call('market:sellPlayer', { userId: session.userId, playerId: it.id, price: Number(it.price), paymentMode: it.currency === 'TIX' ? 'TICKET' : 'APK_TICKET' }, 'market:sellResult', { timeoutMs: 20000 });
          const wait = r?.retryAfter ?? Number(String(r?.message || '').match(/please wait (\d+)/i)?.[1]);
          if (r?.success === false && Number.isFinite(wait)) { await new Promise(res => setTimeout(res, wait * 1000 + 250)); continue; }
          break;
        }
        const row = (drafted[accountId] || []).find(p => p.id === it.id);
        if (r?.success && row) row.listed = true;
        this._log(r?.success ? 'success' : 'warning', r?.success ? 'df.listed' : 'df.listFailed', { name: row?.name || it.id, price: it.price, currency: it.currency, error: r?.message || '' }, `${row?.name || it.id} ${r?.success ? 'listed' : 'not listed'}`, accountId);
      }
    } finally {
      conn.close();
      this._saveDrafted(drafted);
      this.onChanged();
    }
    return this.snapshot();
  }

  clearDrafted(accountId) {
    const drafted = this._drafted();
    if (accountId) delete drafted[accountId]; else for (const k of Object.keys(drafted)) delete drafted[k];
    this._saveDrafted(drafted);
    this.onChanged();
    return this.snapshot();
  }

  shutdown() {
    for (const id of [...this.joined.keys()]) this._leave(id);
    this._stopPolling();
  }
}

module.exports = { DraftService, joinableSlots, levelRange, SLOT_LEVELS };
