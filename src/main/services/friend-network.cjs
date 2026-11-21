const { GameSocket } = require('./game-socket.cjs');

// Friends of our accounts for Auto Trade (game update 2026-11-05, verified live on Pipelne1/2).
// Everything here goes over a plain /socket/ with the account's session cookie, no `register`,
// so nothing is signed out:
//   getFriendsBootstrap {userId} (ack) -> {friends[{id, teamName}], requests[{friendshipId, id}], sent[]}
//   sendFriendRequest {userId, targetUserId} -> event friendRequestResult {success, message}
//   acceptFriendRequest {userId, friendshipId} -> event friendRequestActionResult {success}
//   getFriendFreeAgents {userId, friendId} (ack) -> {success, freeAgents[6], refreshesIn}: the friend's own
//     Scout board (refreshes every 30 min, the friend's callback changes it too)
//   signFriendFreeAgent {userId, friendId, playerId} (ack) -> {success, message, salaryCut, freeAgents};
//     the signer pays its own TK, the player is marked signed on the friend's board.
// Main's friends list is never changed (user 2026-11-05); the one-time setup only adds friendships
// between Harcayıcı (spender) accounts and the other accounts.
const TIMEOUT_MS = 12000;
const FRIENDS_TTL_MS = 10 * 60 * 1000;
const MAX_FRIENDS = 50;
const SPENDER_KEEP_FREE = 1; // a spender keeps one slot free
const DEFAULT_PER_SIDE = 5; // Harcayıcı friends of every account: when one runs out of TK another one signs
const MAX_SOCKETS = 40;      // plain (cookie) connections kept open at once, for the writes only
const LANES = 20;            // spenders worked on at the same time (each one's own steps in order)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class FriendNetwork {
  constructor({ store, sessions, createSocket, activity, onChanged, perSide = () => DEFAULT_PER_SIDE, now = () => Date.now() }) {
    Object.assign(this, { store, sessions, createSocket, activity, now });
    this.perSide = () => Math.max(1, Math.min(20, Math.floor(Number(perSide()) || DEFAULT_PER_SIDE)));
    this.onChanged = onChanged || (() => {});
    this.sockets = new Map();   // accountId -> { gs, userId, at }
    this.friends = new Map();   // accountId -> { ids: Set<userId>, names: Map, at }
    this.setupRun = null;
    this.anon = null;           // one anonymous socket: friend lists read by user id (2026-11-14: 141 lists in 1.4 s)
  }

  async _anon(signal) {
    if (this.anon && !this.anon.closed && this.anon.socket?.connected !== false) return this.anon;
    try { this.anon?.close(); } catch {}
    this.anon = await GameSocket.open({ createSocket: this.createSocket, signal });
    return this.anon;
  }

  _accounts() { return this.store.getAccounts?.() || []; }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _name(id) { return this._account(id)?.name || id; }
  userIdOf(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  accountOfUser(userId) { const accs = this.store.getAccountProfile?.()?.accounts || {}; return Object.keys(accs).find(id => accs[id]?.userId === userId) || null; }
  _log(level, code, params, message, accountId = null) {
    this.activity?.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName: 'Auto Trade', code, params, message });
  }

  // A plain (not registered) connection of the account, reused for a few minutes.
  async plain(accountId, signal) {
    const cur = this.sockets.get(accountId);
    if (cur && !cur.gs.closed && cur.gs.socket?.connected !== false && this.now() - cur.at < 4 * 60 * 1000) { cur.used = this.now(); return cur; }
    try { cur?.gs.close(); } catch {}
    this.sockets.delete(accountId);
    while (this.sockets.size >= MAX_SOCKETS) {
      const [oldest] = [...this.sockets.entries()].sort((a, b) => a[1].used - b[1].used);
      try { oldest[1].gs.close(); } catch {}
      this.sockets.delete(oldest[0]);
    }
    const account = this._account(accountId);
    if (!account) throw new Error('Account not found.');
    const session = await this.sessions.get(account, { owner: 'friends' });
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    const entry = { gs, userId: session.userId, at: this.now(), used: this.now() };
    this.sockets.set(accountId, entry);
    return entry;
  }
  closeAll() { for (const { gs } of this.sockets.values()) { try { gs.close(); } catch {} } this.sockets.clear(); try { this.anon?.close(); } catch {} this.anon = null; }

  // Friend user ids of an account (cached for 10 minutes; `fresh` reads again).
  async friendsOf(accountId, { fresh = false, signal } = {}) {
    const cached = this.friends.get(accountId);
    if (!fresh && cached && this.now() - cached.at < FRIENDS_TTL_MS) return cached;
    const userId = this.userIdOf(accountId);
    let r = null;
    if (userId) r = await (await this._anon(signal)).ack('getFriendsBootstrap', { userId }, { signal, timeoutMs: TIMEOUT_MS }).catch(() => null);
    if (!r?.success) { const c = await this.plain(accountId, signal); r = await c.gs.ack('getFriendsBootstrap', { userId: c.userId }, { signal, timeoutMs: TIMEOUT_MS }); }
    if (!r?.success) throw new Error(r?.error || 'The friend list could not be read.');
    const entry = { ids: new Set((r.friends || []).map(f => f.id)), names: new Map((r.friends || []).map(f => [f.id, f.teamName])), requests: r.requests || [], sent: r.sent || [], max: Number(r.maxFriends) || MAX_FRIENDS, at: this.now() };
    this.friends.set(accountId, entry);
    return entry;
  }
  forget(accountId) { this.friends.delete(accountId); }

  // Is `a` (account id) a friend of the account whose user id is `userId`?
  async isFriend(accountId, userId, opts) {
    try { return (await this.friendsOf(accountId, opts)).ids.has(userId); } catch { return false; }
  }

  async board(viewerId, ownerUserId, signal) {
    const c = await this.plain(viewerId, signal);
    const r = await c.gs.ack('getFriendFreeAgents', { userId: c.userId, friendId: ownerUserId }, { signal, timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.error || r?.message || 'The board could not be read.');
    return { freeAgents: r.freeAgents || [], refreshesIn: Number(r.refreshesIn) || 0 };
  }

  // `buyerId` signs `playerId` off the board of the friend `ownerUserId` with its own TK.
  async signFrom(buyerId, ownerUserId, playerId, signal) {
    const c = await this.plain(buyerId, signal);
    return c.gs.ack('signFriendFreeAgent', { userId: c.userId, friendId: ownerUserId, playerId }, { signal, timeoutMs: TIMEOUT_MS });
  }

  // TK and roster size of an account, read on its plain connection.
  async fundsAndRoster(accountId, signal) {
    const c = await this.plain(accountId, signal);
    const info = await c.gs.call('getUserBasicInfo', { userId: c.userId }, 'userBasicInfo', { signal, timeoutMs: TIMEOUT_MS }).catch(() => null);
    const team = await c.gs.ack('getTeamOptimized', { userId: c.userId }, { signal, timeoutMs: TIMEOUT_MS }).catch(() => null);
    const starters = team?.players?.starters || [], bench = team?.players?.bench || [];
    return { funds: Number(info?.funds), level: Number(info?.level), total: starters.length + bench.length, ids: new Set([...starters, ...bench].map(p => p.id)), bench };
  }

  // ---------- one-time setup ----------
  // Every account in `sideIds` gets `perSide` spender friends (user 2026-11-05: when one runs out
  // of TK another one signs). Spenders with the fewest friends first, at most 49 each; one of them
  // is Lv30+ when there is such a spender (Stok, 5% salary cut chance). A side keeps one free slot.
  // Existing friendships count; Main is never touched.
  plan(spenderIds, sideIds, friendsBy, perSide = this.perSide()) {
    const load = new Map(spenderIds.map(id => [id, friendsBy.get(id)?.ids?.size || 0]));
    const spenderUser = new Map(spenderIds.map(id => [id, this.userIdOf(id)]));
    const level = id => Number(this.store.getAccountProfile?.()?.accounts?.[id]?.level) || 0;
    const pairs = [];
    for (const side of sideIds) {
      const sideFriends = friendsBy.get(side)?.ids || new Set();
      const have = spenderIds.filter(s => sideFriends.has(spenderUser.get(s)));
      let room = MAX_FRIENDS - 1 - sideFriends.size;
      let want = perSide - have.length;
      let hasHi = have.some(s => level(s) >= 30);
      while (want > 0 && room > 0) {
        const free = spenderIds.filter(s => !have.includes(s) && load.get(s) < MAX_FRIENDS - SPENDER_KEEP_FREE);
        if (!free.length) break;
        const pool = !hasHi && free.some(s => level(s) >= 30) ? free.filter(s => level(s) >= 30) : free;
        const pick = pool.sort((a, b) => load.get(a) - load.get(b))[0];
        load.set(pick, load.get(pick) + 1);
        have.push(pick);
        if (level(pick) >= 30) hasHi = true;
        pairs.push({ spender: pick, side });
        want--; room--;
      }
    }
    return pairs;
  }

  snapshotSetup() { return this.setupRun ? { ...this.setupRun } : null; }

  async setup({ spenderIds, sideIds, signal } = {}) {
    if (this.setupRun?.running) throw new Error('The friend setup is already running.');
    const mainId = this.store.getAccountProfile?.()?.mainAccountId || null;
    const spenders = spenderIds.filter(id => id !== mainId && this.userIdOf(id));
    const sides = sideIds.filter(id => id !== mainId && !spenders.includes(id) && this.userIdOf(id));
    if (!spenders.length) throw new Error('Give the Harcayıcı role to at least one account first.');
    this.setupRun = { running: true, startedAt: new Date(this.now()).toISOString(), done: 0, total: 0, failed: 0, step: 'reading', read: 0, toRead: spenders.length + sides.length };
    this.onChanged();
    this._log('info', 'fn.reading', { count: spenders.length + sides.length }, `Friend network: reading ${spenders.length + sides.length} friend lists`);
    try {
      const friendsBy = new Map();
      await Promise.all([...spenders, ...sides].map(async id => {
        if (signal?.aborted) return;
        friendsBy.set(id, await this.friendsOf(id, { fresh: true, signal }).catch(() => ({ ids: new Set() })));
        this.setupRun.read++;
      }));
      this.onChanged();
      const pairs = this.plan(spenders, sides, friendsBy);
      Object.assign(this.setupRun, { total: pairs.length, step: 'adding' });
      this.onChanged();
      this._log('info', 'fn.planned', { count: pairs.length }, `Friend network: ${pairs.length} new friendship(s) to make`);
      const bySpender = new Map();
      for (const p of pairs) { if (!bySpender.has(p.spender)) bySpender.set(p.spender, []); bySpender.get(p.spender).push(p); }
      const { eachAtOnce } = require('./wide.cjs');
      await eachAtOnce([...bySpender.values()], async list => { for (const { spender, side } of list) {
        if (signal?.aborted) break;
        try {
          await this._befriend(spender, side, signal);
          this.setupRun.done++;
          if (this.setupRun.done % 10 === 0) this._log('info', 'fn.progress', { done: this.setupRun.done, total: pairs.length }, `Friend network: ${this.setupRun.done}/${pairs.length}`);
        } catch (error) {
          this.setupRun.failed++;
          this._log('warning', 'fn.failed', { spender: this._name(spender), side: this._name(side), error: error.message }, `Friendship ${this._name(spender)} ↔ ${this._name(side)} failed: ${error.message}`, side);
        }
        this.onChanged();
        await sleep(150);
      } }, LANES);
      this._log('success', 'fn.setupDone', { done: this.setupRun.done, total: pairs.length, failed: this.setupRun.failed }, `Friend network ready · ${this.setupRun.done}/${pairs.length} new friendship(s)`);
      return { done: this.setupRun.done, total: pairs.length, failed: this.setupRun.failed };
    } finally {
      this.setupRun = { ...this.setupRun, running: false, finishedAt: new Date(this.now()).toISOString() };
      this.closeAll();
      this.onChanged();
    }
  }

  // Auto Trade keeps the network itself (user 2026-11-05): at the start of a run (and when the
  // accounts or roles changed) every non-spender account gets a spender friend, and the spenders'
  // lists are cleaned of friends that are not our side accounts (other spenders, old or unknown
  // accounts). Main is never removed or added: a friendship is two-sided.
  syncKey() {
    const mainId = this.store.getAccountProfile?.()?.mainAccountId || null;
    return `n${this.perSide()}|` + this._accounts().filter(a => a.id !== mainId).map(a => `${a.id}:${a.role === 'spender' ? 'S' : 's'}`).sort().join(',');
  }
  async sync({ signal, force = false } = {}) {
    if (this.setupRun?.running) return { skipped: true, reason: 'running' };
    const key = this.syncKey();
    const last = this.store.getSettings?.()?.friendNetSync || {};
    if (!force && last.key === key && this.now() - Date.parse(last.at || 0) < 24 * 3600 * 1000) return { skipped: true };
    const mainId = this.store.getAccountProfile?.()?.mainAccountId || null;
    const mainUser = mainId ? this.userIdOf(mainId) : null;
    const accounts = this._accounts().filter(a => a.id !== mainId && this.userIdOf(a.id));
    const spenders = accounts.filter(a => a.role === 'spender').map(a => a.id);
    const sides = accounts.filter(a => a.role !== 'spender').map(a => a.id);
    if (!spenders.length) return { skipped: true, reason: 'noSpender' };
    let removed = 0;
    this.setupRun = { running: true, step: 'cleaning', read: 0, toRead: spenders.length, done: 0, total: 0, failed: 0, startedAt: new Date(this.now()).toISOString() };
    this.onChanged();
    this._log('info', 'fn.cleaning', { count: spenders.length }, `Friend network: checking ${spenders.length} Harcayıcı lists`);
    const lists = new Map();
    await Promise.all(spenders.map(async sp => { lists.set(sp, await this.friendsOf(sp, { fresh: true, signal }).catch(() => null)); this.setupRun.read++; }));
    this.onChanged();
    const { eachAtOnce } = require('./wide.cjs');
    await eachAtOnce(spenders, async sp => {
      if (signal?.aborted) return;
      const f = lists.get(sp);
      if (!f) return;
      for (const fid of f.ids) {
        if (fid === mainUser) continue;
        const own = this.accountOfUser(fid);
        if (own && sides.includes(own)) continue;
        try { await this._unfriend(sp, fid, signal); removed++; } catch (error) { this._log('warning', 'fn.removeFailed', { spender: this._name(sp), error: error.message }, `${this._name(sp)}: a friend could not be removed: ${error.message}`, sp); }
        await sleep(150);
      }
    }, LANES);
    this.setupRun = { ...this.setupRun, running: false };
    const result = await this.setup({ spenderIds: spenders, sideIds: sides, signal });
    const s = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...s, friendNetSync: { key, at: new Date(this.now()).toISOString() } });
    if (removed) this._log('info', 'fn.cleaned', { count: removed }, `${removed} old friend(s) removed from the Harcayıcı lists`);
    return { ...result, removed };
  }

  async _unfriend(accountId, friendUserId, signal) {
    const c = await this.plain(accountId, signal);
    const r = await c.gs.call('removeFriend', { userId: c.userId, friendId: friendUserId }, 'friendActionResult', { signal, timeoutMs: TIMEOUT_MS });
    if (!r?.success) throw new Error(r?.message || r?.error || 'remove refused');
    this.forget(accountId);
    const other = this.accountOfUser(friendUserId);
    if (other) this.forget(other);
  }

  async _befriend(spenderId, sideId, signal) {
    const s = await this.plain(spenderId, signal);
    const sideUser = this.userIdOf(sideId);
    const sent = await s.gs.call('sendFriendRequest', { userId: s.userId, targetUserId: sideUser }, 'friendRequestResult', { signal, timeoutMs: TIMEOUT_MS });
    if (!sent?.success && !/already/i.test(String(sent?.message || sent?.error || ''))) throw new Error(sent?.message || sent?.error || 'request refused');
    const side = await this.friendsOf(sideId, { fresh: true, signal });
    const req = (side.requests || []).find(r => (r.id || r.userId || r.sender?.id) === s.userId);
    if (req) {
      const c = await this.plain(sideId, signal);
      const ok = await c.gs.call('acceptFriendRequest', { userId: c.userId, friendshipId: req.friendshipId }, 'friendRequestActionResult', { signal, timeoutMs: TIMEOUT_MS });
      if (!ok?.success) throw new Error(ok?.message || ok?.error || 'accept refused');
    }
    this.forget(spenderId);
    this.forget(sideId);
    this._log('success', 'fn.added', { spender: this._name(spenderId), side: this._name(sideId) }, `${this._name(spenderId)} ↔ ${this._name(sideId)} are friends`, sideId);
  }
}

module.exports = { FriendNetwork, MAX_FRIENDS };
