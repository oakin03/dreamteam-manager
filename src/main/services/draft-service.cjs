const { GameSocket } = require('./game-socket.cjs');
const { isNetError } = require('./game-health.cjs');
const { TradeGameAccount, sleep } = require('./trade-game-client.cjs');

// Live Draft over the game's /draft-socket/. Room states and attempts are read
// without logging in; joining and picking use the account's session cookie (no
// `register`, so an open game tab stays signed in). The user picks; the app shows
// the pool, whose turn it is, and keeps the drafted players for market listing.
const PATH = '/draft-socket/';
// Normal draft rooms by slot number (verified against the Draft Hall screen).
const SLOT_LEVELS = { 3: [1, 20], 4: [1, 20], 5: [21, 30], 6: [21, 30], 7: [21, 30], 8: [31, 50], 9: [31, 50], 10: [51, 70], 11: [51, 70], 12: [71, 100] };
const ROOM_SIZE = 10;
const POLL_MS = 2000;
const JOIN_WAIT_MS = 10000;
const ATTEMPT_REREAD_MS = 2000;
const PICK_WAIT_MS = 6000;
const PICK_TRIES = 3;
const PICK_RETRY_MS = 700;

// Slot users may come as ids or as {userId, …} objects.
const slotUserIds = s => (s?.users || []).map(u => (typeof u === 'string' ? u : u?.userId)).filter(Boolean);

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
  constructor({ store, activity, sessions, accountProfile, onChanged, onAttention, createSocket, gameHealth = null, now = () => Date.now(), priceOf = null }) {
    this.gameHealth = gameHealth;
    this.priceOf = priceOf;      // (row, accountId) -> { price, currency } from Auto Trade's pricing
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

  // Drafted players waiting to be listed. A player put on the market leaves the list, and an
  // account whose list is empty is dropped (also cleans rows saved as listed earlier).
  _drafted() {
    const out = {};
    for (const [id, rows] of Object.entries(this.store.getDraftData()?.drafted || {})) {
      const left = (rows || []).filter(r => !r.listed);
      if (left.length) out[id] = left;
    }
    return out;
  }
  _saveDrafted(drafted) { this.store.saveDraftData({ ...(this.store.getDraftData() || {}), drafted }); }

  snapshot() {
    const accounts = this._accounts().map(a => {
      const att = this.attempts[a.id] || null;
      const j = this.joined.get(a.id);
      const level = this._level(a.id);
      // Also in a room the user joined in the game itself: a new draft waits until it ends.
      const userId = this._userId(a.id);
      const inGame = this.slots.find(s => slotUserIds(s).includes(userId))?.slotNumber ?? null;
      const inSlot = j?.slot ?? inGame;
      return {
        id: a.id, name: a.name, level, userId, attempts: att?.draftAttempts ?? null,
        inSlot, inSlotFromGame: !j && inGame != null,
        joinable: joinableSlots(this.slots, level, { attempts: att?.draftAttempts ?? 0, busy: inSlot != null })
      };
    });
    const rooms = [...this.rooms.values()].map(r => ({ ...r, ours: r.ours.map(id => ({ id, name: this._name(id), userId: this.joined.get(id)?.userId || this._userId(id), picking: Boolean(this.joined.get(id)?.picking) })) }));
    return {
      watching: this.watchers > 0, slotsAt: this.slotsAt, error: this.error,
      slots: this.slots.map(s => ({ slotNumber: s.slotNumber, range: levelRange(s.slotNumber), users: s.users?.length || 0, hasStarted: s.hasStarted, cooldownRemaining: s.cooldownRemaining || 0, countdown: s.countdown })),
      accounts, rooms, drafted: this._withPrices(this._drafted())
    };
  }

  // The list price each drafted player gets by default: Auto Trade's pricing (user 2026-11-13).
  _withPrices(drafted) {
    if (!this.priceOf) return drafted;
    const out = {};
    for (const [id, rows] of Object.entries(drafted)) out[id] = rows.map(r => { let s = null; try { s = this.priceOf(r, id); } catch {} return s?.price ? { ...r, suggest: { price: s.price, currency: s.currency } } : r; });
    return out;
  }

  // "Karta çevir" waiting for Auto Trade (it holds the account or main): flagged on the rows,
  // done by main.cjs once both are free.
  queueCards(accountId, ids, on = true) {
    const drafted = this._drafted();
    let n = 0;
    for (const r of drafted[accountId] || []) if (ids.includes(r.id)) { if (on) r.cardsQueued = true; else delete r.cardsQueued; n++; }
    if (!n) return;
    this._saveDrafted(drafted);
    if (on) this._log('info', 'df.cardsQueued', { count: n }, `${n} drafted player(s) wait for Auto Trade · turned into cards when it is done with the account / main`, accountId);
    this.onChanged();
  }
  queuedCards() {
    const out = {};
    for (const [id, rows] of Object.entries(this._drafted())) { const ids = rows.filter(r => r.cardsQueued).map(r => r.id); if (ids.length) out[id] = ids; }
    return out;
  }
  // "Kov" waiting for Auto Trade (it holds the account and the account is not one of its run).
  queueFire(accountId, ids, on = true) {
    const drafted = this._drafted();
    let n = 0;
    for (const r of drafted[accountId] || []) if (ids.includes(r.id)) { if (on) r.fireQueued = true; else delete r.fireQueued; n++; }
    if (!n) return;
    this._saveDrafted(drafted);
    if (on) this._log('info', 'df.fireQueued', { count: n }, `${n} drafted player(s) wait for Auto Trade · fired when it is done with the account`, accountId);
    this.onChanged();
  }
  queuedFire() {
    const out = {};
    for (const [id, rows] of Object.entries(this._drafted())) { const ids = rows.filter(r => r.fireQueued).map(r => r.id); if (ids.length) out[id] = ids; }
    return out;
  }
  // Fired by the running Auto Trade over its own connection.
  firedByAutoTrade(accountId, ids) {
    if (!ids.length) return;
    this._dropDrafted(accountId, ids);
  }

  // Handed to the running Auto Trade: they leave this list (Auto Trade's own list shows them).
  handedToAutoTrade(accountId, ids) {
    const names = (this._drafted()[accountId] || []).filter(r => ids.includes(r.id)).map(r => r.name);
    this._dropDrafted(accountId, ids);
    this._log('success', 'df.handedAT', { names: names.join(', '), count: names.length }, `${names.length} drafted player(s) handed to Auto Trade for cards · ${names.join(', ')}`, accountId);
  }

  // The Draft page is open: poll the hall (and attempts) every 2 s.
  async watch() {
    this.watchers += 1;
    if (this.watchers === 1) {
      const tick = async () => {
        // While the game is unreachable the 2 s polling pauses; the shared check probes instead.
        if (this.gameHealth?.isDown()) { this.error = 'game unreachable'; }
        else {
          try { await this._readSlots(); this.error = null; } catch (error) { this.error = error.message; if (isNetError(error)) { try { this.anon?.close(); } catch {} this.anon = null; this.gameHealth?.reportDown('Draft', error); } }
        }
        this.onChanged();
        if (this.watchers > 0 || this.joined.size) this.poll = setTimeout(tick, POLL_MS);
      };
      // the rooms first (user 2026-11-09: the page waited for every account's attempts before
      // showing which rooms are open); the attempts follow in the background
      await tick();
      this._refreshAttempts().catch(() => {});
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

  // Attempts are always re-read from the game, never counted locally: after joining, when
  // the draft starts and when it ends.
  async _refreshAttempts(ids = this._accounts().map(a => a.id)) {
    const anon = await this._anon();
    const list = ids.filter(id => this._userId(id));
    // 10 at a time on the same socket, the page updates after every group
    for (let i = 0; i < list.length; i += 10) {
      await Promise.all(list.slice(i, i + 10).map(async id => {
        const r = await anon.ack('getDraftAttempts', { userId: this._userId(id) }, { timeoutMs: 8000 }).catch(() => null);
        if (r?.success) this.attempts[id] = { draftAttempts: r.draftAttempts, rookieDraftAttempts: r.rookieDraftAttempts, at: new Date(this.now()).toISOString() };
      }));
      this.onChanged();
    }
  }

  async join(accountId, slotNumber) {
    if (this.joined.has(accountId)) throw new Error('This account is already in a draft.');
    const account = this._accounts().find(a => a.id === accountId);
    if (!account) throw new Error('Account not found.');
    await this._readSlots();
    await this._refreshAttempts([accountId]);
    const level = this._level(accountId);
    const busy = this.slots.some(s => slotUserIds(s).includes(this._userId(accountId)));
    if (!joinableSlots(this.slots, level, { attempts: this.attempts[accountId]?.draftAttempts ?? 0, busy }).includes(Number(slotNumber))) throw new Error('This room cannot be joined by this account now.');
    // The game refuses a join on "draftError" (e.g. already in a draft, room full); a
    // join that is not answered at all is retried once with a fresh login.
    let error = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt === 2) this.sessions.invalidate?.(accountId);
      const session = await this.sessions.get(account, { owner: 'draft' });
      const conn = await GameSocket.open({ createSocket: this.createSocket, path: PATH, cookie: session.cookieHeader });
      const entry = { conn, slot: Number(slotNumber), userId: session.userId };
      this.joined.set(accountId, entry);
      this._listen(accountId, entry);
      const answer = new Promise(resolve => {
        const done = r => { clearTimeout(timer); conn.socket.off('draftJoined', ok); conn.socket.off('draftError', bad); resolve(r); };
        const ok = d => done({ ok: true, d });
        const bad = d => done({ ok: false, message: typeof d === 'string' ? d : (d?.message || d?.error || 'Draft error') });
        const timer = setTimeout(() => done({ ok: false, timeout: true }), JOIN_WAIT_MS);
        conn.socket.on('draftJoined', ok);
        conn.socket.on('draftError', bad);
      });
      conn.socket.emit('joinDraftSlot', { userId: session.userId, slotNumber: Number(slotNumber), draftType: 'CURRENT' });
      const r = await answer;
      if (r.ok) { error = null; break; }
      this._leave(accountId);
      const rm = this._room(Number(slotNumber));
      rm.ours = rm.ours.filter(id => id !== accountId);
      if (!rm.ours.length) this.rooms.delete(Number(slotNumber));
      error = r.timeout ? 'The game did not confirm joining the room.' : r.message;
      if (!r.timeout) break;
    }
    if (error) {
      this._log('warning', 'df.joinFailed', { slot: slotNumber, error }, `Could not join draft ${slotNumber}: ${error}`, accountId);
      this.onChanged();
      throw new Error(error);
    }
    this._log('success', 'df.joined', { slot: slotNumber }, `Joined draft room ${slotNumber}`, accountId);
    // The game takes the attempt when the account joins (or when the draft starts), not at
    // the end: read it again shortly after joining.
    setTimeout(() => this._refreshAttempts([accountId]).catch(() => {}), ATTEMPT_REREAD_MS).unref?.();
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
    s.on('draftState', d => {
      const rm = room();
      Object.assign(rm, { started: Boolean(d?.hasStarted), pickOrder: d?.pickOrder || rm.pickOrder, pickIndex: d?.currentPickIndex ?? rm.pickIndex });
      if (d?.currentPickingUserId && rm.turn?.userId !== d.currentPickingUserId) rm.turn = { index: d.currentPickIndex, seconds: d.pickTimer, userId: d.currentPickingUserId, at: new Date(this.now()).toISOString() };
      touch();
    });
    s.on('draftStart', d => { Object.assign(room(), { started: true, pickOrder: d?.pickOrder || [] }); setTimeout(() => this._refreshAttempts([accountId]).catch(() => {}), ATTEMPT_REREAD_MS).unref?.(); this._log('info', 'df.started', { slot: entry.slot, count: (d?.pickOrder || []).length }, `Draft ${entry.slot} started`, accountId); touch(); });
    s.on('draftPickTimer', d => {
      const rm = room();
      const before = rm.turn?.userId;
      rm.turn = { index: d?.index, seconds: d?.seconds, userId: d?.userId, at: new Date(this.now()).toISOString() };
      rm.pickIndex = d?.index ?? rm.pickIndex;
      // Our account's turn: bring the app forward once per turn.
      // Not again for an account that has already picked in this draft (user 2026-11-13).
      const mine = rm.ours.find(id => this.joined.get(id)?.userId === d?.userId);
      if (mine && before !== d?.userId && !(rm.picked || []).includes(mine)) this.onAttention?.('draftTurn', this._name(mine));
      touch();
    });
    s.on('draftEnded', () => this._ended(entry.slot));
    s.on('disconnect', () => touch());
  }

  // One signDraftPlayer: resolves with the game's answer, a draftError, or {timeout}.
  _signOnce(entry, playerId) {
    const sock = entry.conn.socket;
    return new Promise(resolve => {
      const done = d => { clearTimeout(timer); sock.off('signDraftPlayerResponse', onResp); sock.off('draftError', onErr); resolve(d); };
      const onResp = d => done(d);
      const onErr = d => done({ success: false, message: typeof d === 'string' ? d : (d?.message || d?.error || 'Draft error') });
      const timer = setTimeout(() => done({ success: false, timeout: true }), PICK_WAIT_MS);
      sock.on('signDraftPlayerResponse', onResp);
      sock.on('draftError', onErr);
      sock.emit('signDraftPlayer', { userId: entry.userId, playerId, slotNumber: entry.slot, draftType: 'CURRENT' });
    });
  }

  // The pick went through even if its answer was lost: the player is marked signed
  // and our user shows as signed.
  _signedNow(room, userId, playerId) {
    return Boolean(room.players.find(p => p.id === playerId)?.signed && room.users.find(u => u.userId === userId)?.signed);
  }

  // Ask the game for the room state again (whose turn it is, who signed).
  _resync(entry) {
    try {
      entry.conn.socket.emit('getDraftState', { slotNumber: entry.slot });
      entry.conn.socket.emit('getDraftUsers', { slotNumber: entry.slot });
    } catch {}
  }

  async pick(accountId, playerId) {
    const entry = this.joined.get(accountId);
    if (!entry) throw new Error('This account is not in a draft.');
    if (entry.picking) throw new Error('A pick is already being sent for this account.');
    const room = this._room(entry.slot);
    const player = room.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not in this draft.');
    if (player.signed) throw new Error('This player was already picked.');
    entry.picking = true;
    this.onChanged();
    let r = null;
    try {
      // Picking the moment the turn arrives can be refused ("not your turn" / "please
      // wait") while the game still moves the turn; such answers are retried shortly.
      // The game also answers failures on "draftError", not only on
      // signDraftPlayerResponse; before, those were missed and the button stayed
      // locked for 15 s while the 30 s pick time ran out.
      for (let attempt = 1; attempt <= PICK_TRIES; attempt++) {
        r = await this._signOnce(entry, playerId);
        if (r?.success) break;
        if (this._signedNow(room, entry.userId, playerId)) { r = { success: true }; break; }
        const retry = /turn|wait|not .*yet|too fast|slow down/i.test(String(r?.message || '')) || r?.timeout;
        if (!retry || attempt === PICK_TRIES || room.ended) break;
        await new Promise(res => setTimeout(res, PICK_RETRY_MS));
        this._resync(entry);
      }
    } finally {
      entry.picking = false;
      this.onChanged();
    }
    if (!r?.success) {
      const message = r?.timeout ? 'No answer to the pick.' : (r?.message || 'Pick refused.');
      this._log('warning', 'df.pickFailed', { player: player.name, error: message }, `Pick failed: ${message}`, accountId);
      this._resync(entry);
      throw new Error(message);
    }
    room.picked = [...new Set([...(room.picked || []), accountId])];
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
      await conn.register(session.userId, { owner: 'Draft' });
      for (const it of items) {
        let r = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          r = await conn.call('market:sellPlayer', { userId: session.userId, playerId: it.id, price: Number(it.price), paymentMode: it.currency === 'TIX' ? 'TICKET' : 'APK_TICKET' }, 'market:sellResult', { timeoutMs: 20000 });
          const wait = r?.retryAfter ?? Number(String(r?.message || '').match(/please wait (\d+)/i)?.[1]);
          if (r?.success === false && Number.isFinite(wait)) { await new Promise(res => setTimeout(res, wait * 1000 + 250)); continue; }
          break;
        }
        const row = (drafted[accountId] || []).find(p => p.id === it.id);
        if (r?.success && row) drafted[accountId] = drafted[accountId].filter(p => p !== row);
        this._log(r?.success ? 'success' : 'warning', r?.success ? 'df.listed' : 'df.listFailed', { name: row?.name || it.id, price: it.price, currency: it.currency, error: r?.message || '' }, `${row?.name || it.id} ${r?.success ? 'listed' : 'not listed'}`, accountId);
      }
    } finally {
      conn.close();
      if (!drafted[accountId]?.length) delete drafted[accountId];
      this._saveDrafted(drafted);
      this.onChanged();
    }
    return this.snapshot();
  }

  _dropDrafted(accountId, ids) {
    const drafted = this._drafted();
    drafted[accountId] = (drafted[accountId] || []).filter(p => !ids.includes(p.id));
    if (!drafted[accountId].length) delete drafted[accountId];
    this._saveDrafted(drafted);
    this.onChanged();
  }
  _rowName(accountId, id) { return (this._drafted()[accountId] || []).find(p => p.id === id)?.name || id; }
  _mainId() { return this.store.getAccountProfile?.()?.mainAccountId || null; }

  // Kov / Tümünü kov (user 2026-11-11): the game's FIRE for drafted players (the page asks first).
  async firePlayers(accountId, playerIds) {
    const account = this._accounts().find(a => a.id === accountId);
    if (!account) throw new Error('Account not found.');
    const ids = [...new Set(playerIds || [])];
    if (!ids.length) throw new Error('Player not found.');
    const t = await TradeGameAccount.open({ account, sessions: this.sessions, createSocket: this.createSocket });
    const gone = [];
    let failed = null;
    try {
      for (const id of ids) {
        const name = this._rowName(accountId, id);
        const r = await t.fire(id).catch(error => ({ success: false, error: error.message }));
        // already off the roster (fired by hand / sold) counts as gone
        const ok = r?.success || /not (found|in)/i.test(String(r?.error || r?.message || ''));
        if (ok) gone.push(id); else failed = r?.error || r?.message || 'Fire refused';
        this._log(ok ? 'success' : 'warning', ok ? 'df.fired' : 'df.fireFailed', { name, error: r?.error || r?.message || '' }, ok ? `${name} fired` : `${name} could not be fired: ${r?.error || r?.message || ''}`, accountId);
      }
    } finally {
      t.close();
      if (gone.length) this._dropDrafted(accountId, gone);
    }
    if (failed) throw new Error(failed);
    return this.snapshot();
  }

  // One trade room: `fromId` gives the players, `to` (an open TradeGameAccount of `toAccount`)
  // gives nothing back and pays their salary. Checked on the receiver's roster.
  async _give(fromId, toAccount, to, ids) {
    const from = this._accounts().find(a => a.id === fromId);
    const s = await TradeGameAccount.open({ account: from, sessions: this.sessions, createSocket: this.createSocket });
    let roomId = null;
    try {
      const password = String(Math.floor(100000 + Math.random() * 900000));
      roomId = await s.createRoom('Draft', password);
      const sideJoined = s.expect('joinedRoomData', d => d?.roomId === roomId);
      const room = await to.joinRoom(roomId, password);
      await sideJoined.catch(() => null);
      const sel = ids.map(id => (room.hostPlayers || []).find(p => p.id === id));
      if (sel.some(p => !p)) throw new Error('A drafted player is not on this account any more.');
      const upd = to.expect('tradeSelectionUpdate', d => d?.roomId === roomId && (d.hostSelectedPlayers || []).length === sel.length);
      s.select(roomId, sel);
      await upd;
      await sleep(300);
      for (let attempt = 1; ; attempt++) {
        const both = to.expect('acceptTradeUpdate', d => d?.hostAccepted && d?.guestAccepted, 7000);
        s.accept(roomId);
        await sleep(250);
        to.accept(roomId);
        try { await both; break; } catch (error) { if (attempt >= 3) throw error; }
      }
      const resultP = to.expect('tradeResult', () => true).catch(error => ({ success: false, message: error.message }));
      to.confirm(roomId, sel, []);
      const result = await resultP;
      // the game does not always answer: the receiver's roster decides
      const mr = (await to.roster().catch(() => null))?.players || {};
      const onTo = new Set([...(mr.starters || []), ...(mr.bench || [])].map(p => p.id));
      if (!ids.every(id => onTo.has(id))) throw new Error(`Trade to ${toAccount.name} failed: ${result?.message || 'the players did not move'}`);
    } finally {
      if (roomId) s.cancelRoom(roomId);
      s.close();
    }
  }

  // Satılabilir / Stok of the automatic draft (user 2026-11-24): to a Harcayıcı, which puts them on
  // the market at Auto Trade's price. `spenderId` = the drafting account itself: it only lists.
  async toSpender(accountId, spenderId, playerIds) {
    const ids = [...new Set(playerIds || [])];
    const rows = (this._drafted()[accountId] || []).filter(r => ids.includes(r.id));
    if (!rows.length) throw new Error('Player not found.');
    const names = rows.map(r => r.name).join(', ');
    if (spenderId !== accountId) {
      const sp = this._accounts().find(a => a.id === spenderId);
      if (!sp) throw new Error('Account not found.');
      const t = await TradeGameAccount.open({ account: sp, sessions: this.sessions, createSocket: this.createSocket });
      try { await this._give(accountId, sp, t, ids); } finally { t.leave?.(); t.close(); }
      this._dropDrafted(accountId, ids);
      this.addRows(spenderId, rows.map(r => ({ ...r, from: this._name(accountId) })));
      this._log('success', 'df.toSpender', { names, name: sp.name }, `${names} → ${sp.name} (Harcayıcı)`, accountId);
    }
    const priced = (this._withPrices({ [spenderId]: rows })[spenderId] || []);
    const items = priced.filter(r => r.suggest?.price).map(r => ({ id: r.id, price: r.suggest.price, currency: r.suggest.currency }));
    if (items.length) await this.listPlayers(spenderId, items);
    return items.length;
  }

  // what the automatic draft decided for a picked player (role, where it goes)
  tagRows(accountId, tags) {
    const drafted = this._drafted();
    let n = 0;
    for (const r of drafted[accountId] || []) if (tags[r.id]) { Object.assign(r, tags[r.id]); n++; }
    if (n) { this._saveDrafted(drafted); this.onChanged(); }
  }

  // Karta çevir (user 2026-11-11): the drafted players go to main in a trade room (main gives
  // nothing back), then main turns them into star cards (Make). On main itself only the Make.
  async toCards(accountId, playerIds) {
    const mainId = this._mainId();
    if (!mainId) throw new Error('No Main account is set.');
    const accounts = this._accounts();
    const side = accounts.find(a => a.id === accountId);
    const main = accounts.find(a => a.id === mainId);
    if (!side || !main) throw new Error('Account not found.');
    const ids = [...new Set(playerIds || [])];
    if (!ids.length) throw new Error('Player not found.');
    const names = ids.map(id => this._rowName(accountId, id)).join(', ');
    const m = await TradeGameAccount.open({ account: main, sessions: this.sessions, createSocket: this.createSocket });
    const s = null, roomId = null;
    try {
      if (accountId !== mainId) {
        await this._give(accountId, main, m, ids);
        this._log('success', 'df.toMain', { names, main: main.name }, `${names} → ${main.name}`, accountId);
      }
      const r = await m.makeCards(ids);
      if (!r?.success) {
        if (accountId !== mainId) this._dropDrafted(accountId, ids); // they are on main now
        throw new Error(`Make failed on ${main.name}: ${r?.message || r?.error || 'no answer'}`);
      }
      this._log('success', 'df.carded', { names, count: ids.length }, `${ids.length} drafted player(s) turned into star cards · ${names}`, mainId);
      this._dropDrafted(accountId, ids);
    } catch (error) {
      this._log('error', 'df.cardFailed', { names, error: error.message }, `Turning into cards failed: ${error.message}`, accountId);
      throw error;
    } finally {
      if (roomId) s?.cancelRoom(roomId);
      m.leave();
      s?.close();
      m.close();
    }
    return this.snapshot();
  }

  // Players that came from elsewhere (Bag -> Random Card, user 2026-11-18) join the same list with a
  // source tag, so Fire / To cards / List (with Auto Trade's prices) work on them the same way.
  addRows(accountId, rows) {
    const drafted = this._drafted();
    const have = new Set((drafted[accountId] || []).map(r => r.id));
    drafted[accountId] = [...(drafted[accountId] || []), ...rows.filter(r => r.id && !have.has(r.id))];
    this._saveDrafted(drafted);
    this.onChanged();
  }

  // source: 'card' clears only the Random Card rows, 'draft' only the drafted ones, none clears all.
  clearDrafted(accountId, source = null) {
    const drafted = this._drafted();
    const keep = r => (source ? (r.source || 'draft') !== source : false);
    for (const k of Object.keys(drafted)) if (!accountId || k === accountId) { drafted[k] = drafted[k].filter(keep); if (!drafted[k].length) delete drafted[k]; }
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
