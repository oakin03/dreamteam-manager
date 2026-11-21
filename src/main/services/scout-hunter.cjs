const { GameSocket } = require('./game-socket.cjs');
const { WIDE, eachWithSocket } = require('./wide.cjs');
const { TradeGameAccount } = require('./trade-game-client.cjs');
const { OwnedSwap } = require('./owned-swap.cjs');

// Scout Avcısı (user 2026-11-13): runs without end like Auto Buy and pauses nothing. It watches the
// Scout board of every account and of every friend of our accounts; a player of its own list found
// there is signed and put on the market at once (Auto Trade's pricing), and shows in the bought
// table at the bottom of the page with the board it came from.
//
// Reads are anonymous (no sign-in, nobody is signed out): getFreeAgent {userId} reads ANY user's
// board, getFriendsBootstrap {userId} any account's friends (live 2026-11-11 / 11-13). Boards renew
// every 30 minutes (cooldownEnds): a board is read again right after that, at the latest every
// 10 minutes (a callback renews it earlier).
//
// Who signs (user's rules):
//   "Lv30+" off: the board's owner when it is our account and has the TK; else one of our accounts
//     that is its friend and has the TK; else (owner is ours) a new friendship: one of our accounts
//     with the TK befriends it (Main's friends list is never changed).
//   "Lv30+" on: the same, only accounts of level 30+ (the 5% salary cut chance).
//   A board of someone else with no fitting friend of ours: not signed, a warning is shown.
//   Main may sign over its existing friendships and its own board.
// An account Auto Trade is using, or whose Auto Play runs in the browser, is not used.
// A secret player is recognised by its price (the value of the day names one player).
const TICK_MS = 10 * 1000;
const FRIENDS_TTL_MS = 10 * 60 * 1000;
const BOARD_MAX_MS = 10 * 60 * 1000;
const AFTER_RENEW_MS = 5 * 1000;
const READ_TIMEOUT_MS = 12000;
const MAX_FRIENDS = 50;
const MAX_WARNINGS = 60;
const PAYMENT_MODE = { TIX: 'TICKET', APK: 'APK_TICKET' };
const AUTH = /auth|not authenticated|unauthor|register/i;
// the Callback item of the Free Agency window (game client 2026-11-18: useCallbackItem {userId, itemId})
const CALLBACK_ITEM_ID = 'cmhdaubrh0003okmgozsa5qdm';
const REFRESH_DEFAULT = { free: false, items: false, freeAccounts: [], itemAccounts: [] };
// "Main's signings go to a side account (spenders first)" (user 2026-11-19, default on): a player
// Main signs is traded to a side account at once and that side lists it at the Auto Trade price.
const TRADE_TRIES = 3;
const sleepMs = ms => new Promise(res => setTimeout(res, ms));

class ScoutHunter {
  constructor({ store, activity, sessions, friendNet, onChanged, createSocket, gameHealth = null, priceOf = null, recordListed = null, isBusy = () => false, now = () => Date.now(), tickMs = TICK_MS }) {
    Object.assign(this, { store, activity, sessions, friendNet, createSocket, gameHealth, priceOf, recordListed, isBusy, now, tickMs });
    this.onChanged = onChanged || (() => {});
    this.timer = null;
    this.ticking = false;
    this.friendsAt = 0;
    this.friendsBy = new Map();   // our accountId -> Set(friend userId)
    this.names = new Map();       // userId -> team name (friends and our accounts)
    this.boards = new Map();      // owner userId -> { nextAt, readAt, size }
    this.seen = new Set();        // owner|playerId|renew already handled (bought or warned)
    this.stats = { boards: 0, lastScanAt: null, scans: 0 };
  }

  // ---------- data ----------
  _data() { const d = { watch: [], running: false, warnings: [], ...(this.store.getScoutHunter?.() || {}) }; d.refresh = { ...REFRESH_DEFAULT, ...(d.refresh || {}) }; d.mainToSide = d.mainToSide !== false; return d; }
  setOption(patch = {}) {
    const d = this._data();
    if ('mainToSide' in patch) d.mainToSide = Boolean(patch.mainToSide);
    this._save(d);
    return this.snapshot();
  }
  _save(d) { this.store.saveScoutHunter?.(d); this.onChanged(); }
  _accounts() { return (this.store.getAccounts?.() || []).filter(a => !a.signupPending); }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _name(id) { return this._account(id)?.name || id; }
  _profile(id) { return this.store.getAccountProfile?.()?.accounts?.[id] || {}; }
  _userId(id) { return this._profile(id).userId || null; }
  _level(id) { return Number(this._profile(id).level) || 0; }
  _mainId() { return this.store.getAccountProfile?.()?.mainAccountId || null; }
  _accountOfUser(userId) { return this._accounts().find(a => this._userId(a.id) === userId)?.id || null; }
  // the already-owned helper logs with its own os.* codes (their texts exist already)
  _osLog(level, code, params, message, accountId = null) { this.activity.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName: 'Scout Avcısı', code, params, message }); }
  _log(level, code, params, message, accountId = null) {
    this.activity.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName: 'Scout Avcısı', code: `sh.${code}`, params, message });
  }

  snapshot() {
    const d = this._data();
    return { watch: d.watch, running: Boolean(this.timer), warnings: d.warnings, refresh: d.refresh, mainToSide: d.mainToSide, stats: { ...this.stats, boards: this.boards.size } };
  }

  // ---------- list ----------
  addWatch(players) {
    const d = this._data();
    const have = new Set(d.watch.map(w => w.playerId));
    for (const p of players || []) if (p?.id && !have.has(p.id)) d.watch.push({ playerId: p.id, name: p.name, team: p.team || null, rating: p.rating || null, position: p.position || null, lv30: false, qty: null, bought: 0, enabled: true });
    this._save(d);
    return this.snapshot();
  }
  updateWatch(playerId, patch) {
    const d = this._data();
    const w = d.watch.find(x => x.playerId === playerId);
    if (!w) throw new Error('Player not found in the list.');
    if ('lv30' in patch) w.lv30 = Boolean(patch.lv30);
    if ('enabled' in patch) w.enabled = Boolean(patch.enabled);
    if ('qty' in patch) { const n = Math.floor(Number(patch.qty)); w.qty = n >= 1 ? n : null; }
    if (patch.resetBought) w.bought = 0;
    this._save(d);
    return this.snapshot();
  }
  removeWatch(ids) {
    const d = this._data();
    const drop = new Set(ids || []);
    d.watch = d.watch.filter(w => !drop.has(w.playerId));
    this._save(d);
    return this.snapshot();
  }
  // Daily free Scout refreshes and Callback items (user 2026-11-18: both off by default; the user
  // picks the accounts each one may use)
  setRefresh(patch = {}) {
    const d = this._data();
    const r = d.refresh;
    if ('free' in patch) r.free = Boolean(patch.free);
    if ('items' in patch) r.items = Boolean(patch.items);
    const known = new Set(this._accounts().map(a => a.id));
    if (Array.isArray(patch.freeAccounts)) r.freeAccounts = [...new Set(patch.freeAccounts)].filter(id => known.has(id));
    if (Array.isArray(patch.itemAccounts)) r.itemAccounts = [...new Set(patch.itemAccounts)].filter(id => known.has(id));
    this._save(d);
    return this.snapshot();
  }
  clearWarnings() { const d = this._data(); d.warnings = []; this._save(d); return this.snapshot(); }

  // ---------- run ----------
  start() {
    if (this.timer) return this.snapshot();
    const d = this._data();
    if (!d.watch.some(w => w.enabled !== false)) throw new Error('Add at least one player to the list.');
    d.running = true;
    this._save(d);
    this.timer = setInterval(() => this.tick().catch(() => {}), this.tickMs);
    this.timer.unref?.();
    this._log('info', 'started', { players: d.watch.filter(w => w.enabled !== false).length }, `Scout Avcısı started · ${d.watch.filter(w => w.enabled !== false).length} player(s) on the list`);
    this.tick().catch(() => {});
    return this.snapshot();
  }
  stop({ remember = true } = {}) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; this._log('info', 'stopped', {}, 'Scout Avcısı stopped'); }
    if (remember) { const d = this._data(); d.running = false; this._save(d); }
    this.friendNet?.closeAll?.();
    this.onChanged();
    return this.snapshot();
  }
  // after an app restart (user: it goes on by itself)
  resumeIfRunning() { if (this._data().running && !this.timer) { try { this.start(); } catch {} } }

  async tick() {
    if (this.ticking || !this.timer) return;
    if (this.gameHealth?.isDown?.()) return;
    this.ticking = true;
    try {
      if (this.now() - this.friendsAt > FRIENDS_TTL_MS) await this._readFriends();
      const due = [...this._owners()].filter(u => !(this.boards.get(u)?.nextAt > this.now()));
      if (!due.length) return;
      const found = [];
      const own = new Map(); // our accountId -> { attemptsLeft, wanted }
      await eachWithSocket(due, () => GameSocket.open({ createSocket: this.createSocket }), async (gs, ownerUser) => {
        const r = await gs.ack('getFreeAgent', { userId: ownerUser }, { timeoutMs: READ_TIMEOUT_MS });
        const renew = Number(r?.cooldownEnds) || 0;
        const next = renew > this.now() ? Math.min(renew + AFTER_RENEW_MS, this.now() + BOARD_MAX_MS) : this.now() + BOARD_MAX_MS;
        this.boards.set(ownerUser, { nextAt: next, readAt: this.now(), renew });
        let wanted = 0;
        for (const agent of this._unmask(r?.freeAgents || [])) {
          if (agent.isSigned) continue;
          const w = this._wanted(agent);
          if (w) { found.push({ ownerUser, renew, agent, watch: w }); wanted++; }
        }
        const acc = this._accountOfUser(ownerUser);
        if (acc && r) own.set(acc, { attemptsLeft: Number(r.attemptsLeft) || 0, wanted });
      }, { limit: WIDE });
      this.stats.scans += 1;
      this.stats.lastScanAt = new Date(this.now()).toISOString();
      for (const f of found) await this._handle(f).catch(error => this._warn(f, 'error', error.message));
      await this._refreshBoards(own);
    } finally {
      this.ticking = false;
      this.onChanged();
    }
  }

  // One refresh per selected account per scan, when its own board has nothing of the list: the free
  // daily attempts first, then (if allowed) a Callback item. The new board is checked at once.
  async _refreshBoards(own) {
    const r = this._data().refresh;
    if (!r.free && !r.items) return;
    const free = new Set(r.free ? r.freeAccounts : []);
    const items = new Set(r.items ? r.itemAccounts : []);
    for (const [acc, b] of own) {
      if (!this.timer) return;
      if (b.wanted || this.isBusy(acc)) continue;
      const useFree = free.has(acc) && b.attemptsLeft > 0;
      const useItem = !useFree && items.has(acc) && !(this.noItemsUntil?.get(acc) > this.now());
      if (!useFree && !useItem) continue;
      let reg = null;
      try {
        reg = await this._reg(acc);
        let res;
        if (useFree) {
          res = await reg.gs.ack('CallBackFreeAgent', { userId: reg.userId }, { timeoutMs: READ_TIMEOUT_MS });
        } else {
          const q = await reg.gs.ack('getCallbackItem', { userId: reg.userId }, { timeoutMs: READ_TIMEOUT_MS }).catch(() => null);
          if (!(Number(q?.quantity) > 0)) { (this.noItemsUntil ||= new Map()).set(acc, this.now() + 30 * 60 * 1000); continue; }
          res = await reg.gs.ack('useCallbackItem', { userId: reg.userId, itemId: CALLBACK_ITEM_ID }, { timeoutMs: READ_TIMEOUT_MS });
        }
        if (!res?.success) { this._log('warning', 'refreshFailed', { kind: useFree ? 'free' : 'item', error: res?.error || res?.message || '' }, `Scout refresh failed · ${res?.error || res?.message || 'refused'}`, acc); if (!useFree) (this.noItemsUntil ||= new Map()).set(acc, this.now() + 30 * 60 * 1000); continue; }
        const left = useFree ? Number(res.attemptsLeft ?? b.attemptsLeft - 1) : Number(res.callbackItems ?? NaN);
        this._log('info', useFree ? 'refreshed' : 'itemUsed', { left: Number.isFinite(left) ? left : '—' }, useFree ? `Scout refreshed (daily) · ${left} left` : `Callback item used · ${Number.isFinite(left) ? left : '—'} left`, acc);
        const ownerUser = this._userId(acc);
        const renew = `cb${this.now()}`;
        this.boards.set(ownerUser, { nextAt: this.now(), readAt: this.now(), renew });
        if (reg.own) { try { reg.gs.close(); } catch {} reg = null; }
        for (const agent of this._unmask(res.freeAgents || [])) {
          if (agent.isSigned) continue;
          const w = this._wanted(agent);
          if (w) { const f = { ownerUser, renew, agent, watch: w }; await this._handle(f).catch(error => this._warn(f, 'error', error.message)); }
        }
      } catch (e) {
        this._log('warning', 'refreshFailed', { kind: useFree ? 'free' : 'item', error: e.message }, `Scout refresh failed · ${e.message}`, acc);
      } finally {
        if (reg?.own) { try { reg.gs.close(); } catch {} }
      }
    }
  }

  // board owners: our accounts and every friend of them
  _owners() {
    const out = new Set(this._accounts().map(a => this._userId(a.id)).filter(Boolean));
    for (const set of this.friendsBy.values()) for (const u of set) out.add(u);
    return out;
  }

  async _readFriends() {
    const ids = this._accounts().map(a => a.id).filter(id => this._userId(id));
    const next = new Map();
    await eachWithSocket(ids, () => GameSocket.open({ createSocket: this.createSocket }), async (gs, id) => {
      const r = await gs.ack('getFriendsBootstrap', { userId: this._userId(id) }, { timeoutMs: READ_TIMEOUT_MS });
      if (!r?.success) return;
      next.set(id, new Set((r.friends || []).map(f => f.id)));
      for (const f of r.friends || []) if (f.teamName) this.names.set(f.id, f.teamName);
    }, { limit: WIDE });
    for (const a of this._accounts()) { const u = this._userId(a.id); if (u) this.names.set(u, a.name); }
    this.friendsBy = next;
    this.friendsAt = this.now();
  }

  // A secret becomes the player its price names (values are unique over 1000 TK).
  _unmask(list) {
    let byValue = null;
    return list.map(a => {
      if (!a?.isSecret || a.isSigned) return a;
      if (!byValue) { byValue = new Map(); for (const p of this.store.getPlayersData?.()?.players || []) { const v = Number(p.value); if (v > 0) byValue.set(v, byValue.has(v) ? null : p); } }
      const p = byValue.get(Number(a.baseSalary));
      return p ? { ...a, id: p.id, name: p.name, visualName: p.name, rating: p.rating, position: p.position, secret: true, signId: a.id } : { ...a, secretUnknown: true };
    });
  }

  _wanted(agent) {
    const w = this._data().watch.find(x => x.playerId === agent.id && x.enabled !== false);
    if (!w) return null;
    if (w.qty != null && (w.bought || 0) >= w.qty) return null;
    return w;
  }

  _warn(f, reason, detail = '') {
    const key = `${f.ownerUser}|${f.agent.id}|${f.renew}|${reason}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const d = this._data();
    const owner = this.names.get(f.ownerUser) || '?';
    d.warnings = [{ at: new Date(this.now()).toISOString(), player: f.agent.name, owner, reason, detail, price: Number(f.agent.baseSalary) || null }, ...(d.warnings || [])].slice(0, MAX_WARNINGS);
    this._save(d);
    this._log('warning', 'notBought', { player: f.agent.name, owner, reason, detail }, `${f.agent.name} on ${owner}'s Scout was not signed · ${reason}${detail ? ` (${detail})` : ''}`);
  }

  // Funds (getUserBasicInfo, answered on the event userBasicInfo {id, funds}) and roster
  // (getTeamOptimized ack) of many accounts at once on one anonymous socket; cached 20 s.
  async _stats(ids) {
    this.statCache ||= new Map();
    const fresh = this.now() - (this.statAt || 0) < 20000;
    const need = ids.filter(id => !(fresh && this.statCache.has(id)) && this._userId(id));
    if (need.length) {
      let gs = null;
      try {
        gs = await GameSocket.open({ createSocket: this.createSocket });
        const byUser = new Map(need.map(id => [this._userId(id), id]));
        const funds = new Map();
        const onInfo = d => { const id = byUser.get(d?.id); if (id && d?.success !== false) funds.set(id, Number(d.funds)); };
        gs.socket.on('userBasicInfo', onInfo);
        const teams = await Promise.all(need.map(id => {
          gs.socket.emit('getUserBasicInfo', { userId: this._userId(id) });
          return gs.ack('getTeamOptimized', { userId: this._userId(id) }, { timeoutMs: 12000 }).catch(() => null);
        }));
        for (let i = 0; i < 30 && funds.size < need.length; i++) await new Promise(r => setTimeout(r, 200));
        gs.socket.off('userBasicInfo', onInfo);
        need.forEach((id, i) => {
          const t = teams[i];
          const players = [...(t?.players?.starters || []), ...(t?.players?.bench || [])];
          if (!funds.has(id) || !t?.players) { this.statCache.delete(id); return; }
          this.statCache.set(id, { funds: funds.get(id), total: players.length, ids: new Set(players.map(p => p.id)) });
        });
        this.statAt = this.now();
      } catch { /* the accounts not read count as "unread" */ }
      finally { try { gs?.close(); } catch {} }
    }
    return this.statCache;
  }

  // ---------- one find ----------
  async _handle(f) {
    const key = `${f.ownerUser}|${f.agent.id}|${f.renew}`;
    if (this.seen.has(key)) return;
    const price = Number(f.agent.baseSalary) || 0;
    const ownerAcc = this._accountOfUser(f.ownerUser);
    const lv30 = Boolean(f.watch.lv30);
    const fits = id => !this.isBusy(id) && (!lv30 || this._level(id) >= 30);
    // Funds and roster of every candidate at once, read without a sign-in (2026-11-17: the old one-by-
    // one read over each account's session failed now and then and the account counted as "no TK").
    const info = await this._stats(this._accounts().map(a => a.id));
    const why = { busy: 0, tk: 0, full: 0, owned: 0, unread: 0 };
    const can = async id => {
      if (this.isBusy(id)) { why.busy++; return false; }
      if (lv30 && this._level(id) < 30) return false;
      const s = info.get(id);
      if (!s) { why.unread++; return false; }
      if (s.ids.has(f.agent.id)) { why.owned++; return false; }
      if (s.total >= 11) { why.full++; return false; }
      if (!(s.funds >= price)) { why.tk++; return false; }
      return true;
    };
    // 1. the owner itself (its own board)
    let buyer = null, via = 'own';
    if (ownerAcc && await can(ownerAcc)) buyer = ownerAcc;
    // 2. a friend of the owner with the TK (most TK first)
    if (!buyer) {
      const friends = [...this.friendsBy.entries()].filter(([, set]) => set.has(f.ownerUser)).map(([id]) => id).filter(id => id !== ownerAcc);
      for (const id of friends) await can(id);
      const ok = friends.filter(id => info.get(id) && info.get(id).funds >= price && !info.get(id).ids.has(f.agent.id) && info.get(id).total < 11 && fits(id)).sort((a, b) => info.get(b).funds - info.get(a).funds);
      if (ok.length) { buyer = ok[0]; via = 'friend'; }
    }
    // 3. a new friendship (only when the owner is our account; never with Main)
    if (!buyer && ownerAcc && ownerAcc !== this._mainId()) {
      const ownerFriends = this.friendsBy.get(ownerAcc)?.size || 0;
      if (ownerFriends < MAX_FRIENDS - 1) {
        const pool = this._accounts().map(a => a.id).filter(id => id !== ownerAcc && id !== this._mainId() && !(this.friendsBy.get(id)?.has(f.ownerUser)) && (this.friendsBy.get(id)?.size || 0) < MAX_FRIENDS - 1);
        for (const id of pool) await can(id);
        const ok = pool.filter(id => info.get(id) && info.get(id).funds >= price && !info.get(id).ids.has(f.agent.id) && info.get(id).total < 11 && fits(id)).sort((a, b) => info.get(b).funds - info.get(a).funds);
        if (ok.length) {
          await this.friendNet._befriend(ok[0], ownerAcc);
          this.friendsBy.get(ok[0])?.add(f.ownerUser);
          this.friendsBy.get(ownerAcc)?.add(this._userId(ok[0]));
          this._log('info', 'befriended', { buyer: this._name(ok[0]), owner: this._name(ownerAcc) }, `${this._name(ok[0])} and ${this._name(ownerAcc)} became friends to sign ${f.agent.name}`, ok[0]);
          buyer = ok[0]; via = 'friend';
        }
      }
    }
    // 4. every account that could sign it has the player already (user 2026-11-19): one of them parks
    //    its own copy (equipment / skill / lineup remembered), signs, lists the new one and takes its
    //    copy back. Sides first, Main last.
    let swap = false;
    if (!buyer && why.owned) {
      const signers = new Set([ownerAcc, ...[...this.friendsBy.entries()].filter(([, set]) => set.has(f.ownerUser)).map(([id]) => id)].filter(Boolean));
      const mainId = this._mainId();
      const ok = [...signers].filter(id => { const st = info.get(id); return st && st.ids.has(f.agent.id) && st.funds >= price && fits(id); })
        .sort((a, b) => (a === mainId) - (b === mainId) || info.get(b).funds - info.get(a).funds);
      if (ok.length) { buyer = ok[0]; via = buyer === ownerAcc ? 'own' : 'friend'; swap = true; }
    }
    if (!buyer) {
      // the real reason: no friend of the owner at all, or the candidates were busy / short of TK / full
      const ownerFriendsOfOurs = [...this.friendsBy.entries()].filter(([, set]) => set.has(f.ownerUser)).length;
      const reason = lv30 ? 'noLv30' : !ownerAcc && !ownerFriendsOfOurs ? 'noFriend' : 'noBuyer';
      const parts = [`${price} TK`];
      if (why.tk) parts.push(`TK ${why.tk}`);
      if (why.busy) parts.push(`busy ${why.busy}`);
      if (why.full) parts.push(`full ${why.full}`);
      if (why.owned) parts.push(`owned ${why.owned}`);
      if (why.unread) parts.push(`unread ${why.unread}`);
      this._warn(f, reason, parts.join(' · '));
      return;
    }
    this.seen.add(key);
    this.statCache?.delete(buyer); // its funds and roster change with the signing
    await this._buyAndList(f, buyer, via, ownerAcc, price, { swap });
  }

  // A registered connection of the account for the market (another service's live one is borrowed).
  async _reg(accountId) {
    const userId = this._userId(accountId);
    const borrowed = GameSocket.borrow?.(userId);
    if (borrowed) return { gs: borrowed, userId, own: false };
    const session = await this.sessions.get(this._account(accountId), { owner: 'scout-hunter' });
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader });
    try { await gs.register(session.userId, { owner: 'Scout Avcısı' }); } catch (e) { gs.close(); throw e; }
    return { gs, userId: session.userId, own: true };
  }

  async _buyAndList(f, buyer, via, ownerAcc, price, { swap = false } = {}) {
    const signId = f.agent.signId || f.agent.id;
    let r, reg = null, parked = null;
    try {
      if (swap) {
        reg = await this._reg(buyer);
        const os = new OwnedSwap({ gs: reg.gs, userId: reg.userId, log: (level, code, params, message) => this._osLog(level, code, params, `${f.agent.name}: ${message}`, buyer) });
        const prep = await os.prepare(f.agent.id, f.agent.name).catch(error => ({ ok: false, reason: 'failed', message: error.message }));
        if (!prep.ok) {
          this._log('warning', 'ownedFailed', { player: f.agent.name, error: prep.message || prep.reason }, `${f.agent.name} is in every fitting roster and the already-owned way failed on ${this._name(buyer)} · ${prep.message || prep.reason}`, buyer);
          return;
        }
        parked = prep.record;
        this._log('info', 'ownedParked', { player: f.agent.name, buyer: this._name(buyer) }, `${f.agent.name} is in every fitting roster · ${this._name(buyer)} parked its own copy to sign the new one`, buyer);
      }
      if (via === 'own') {
        reg = await this._reg(buyer);
        r = await reg.gs.ack('signFreeAgent', { userId: reg.userId, playerId: signId }, { timeoutMs: READ_TIMEOUT_MS });
      } else {
        r = await this.friendNet.signFrom(buyer, f.ownerUser, signId);
      }
      if (!r?.success) throw new Error(r?.message || r?.error || 'the game refused the signing');
      const realId = r.revealedPlayer?.id || f.agent.id;
      const discounted = Boolean(r.salaryCut);
      const salary = discounted ? Math.floor(price * 0.95) : price;
      const owner = this.names.get(f.ownerUser) || (ownerAcc ? this._name(ownerAcc) : '?');
      // The base comes from the players list: a secret's board row carries its price as the base (user 2026-11-13).
      const known = (this.store.getPlayersData?.()?.players || []).find(p => p.id === realId);
      const base = Number(known?.base) || (f.agent.secret || f.agent.isSecret ? null : Number(f.agent.newBaseSalary) || null);
      const player = { id: realId, name: r.revealedPlayer?.name || f.agent.name, position: f.agent.position, baseSalary: price, signedSalary: salary, newBaseSalary: base };
      this._log('success', 'bought', { player: player.name, owner, buyer: this._name(buyer), price: salary, cut: discounted ? 1 : 0 }, `${player.name} signed from ${owner}'s Scout by ${this._name(buyer)} · ${salary} TK${discounted ? ' (5% off)' : ''}`, buyer);
      const d = this._data();
      const w = d.watch.find(x => x.playerId === f.watch.playerId);
      if (w) { w.bought = (w.bought || 0) + 1; this._save(d); }
      // Main's signing goes to a side account (spenders first), which lists it (default on)
      let seller = buyer;
      if (buyer === this._mainId() && this._data().mainToSide) {
        if (reg?.own) { try { reg.gs.close(); } catch {} }
        reg = null;
        const side = await this._toSide(buyer, player).catch(e => { this._log('warning', 'toSideFailed', { player: player.name, error: e.message }, `${player.name} could not be given to a side account: ${e.message} · Main lists it`, buyer); return null; });
        if (side) seller = side;
      }
      // the market at Auto Trade's price (the discounted one when signed 5% off)
      const lp = this.priceOf?.(player, seller, discounted) || null;
      reg ||= await this._reg(seller);
      if (lp?.fire) {
        const fr = await reg.gs.ack('firePlayer', { userId: reg.userId, playerId: realId }, { timeoutMs: READ_TIMEOUT_MS }).catch(e => ({ success: false, error: e.message }));
        this._log(fr?.success ? 'info' : 'warning', 'fired', { player: player.name }, `${player.name} was not signed 5% off · fired (Auto Trade pricing)`, seller);
        return;
      }
      if (!lp?.price) throw new Error(`${player.name}: no list price in Auto Trade's pricing`);
      let s = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        s = await reg.gs.call('market:sellPlayer', { userId: reg.userId, playerId: realId, price: Number(lp.price), paymentMode: PAYMENT_MODE[lp.currency] || 'TICKET' }, 'market:sellResult', { timeoutMs: 20000 });
        const wait = s?.retryAfter ?? Number(String(s?.message || '').match(/please wait (\d+)/i)?.[1]);
        if (s?.success === false && Number.isFinite(wait)) { await new Promise(res => setTimeout(res, wait * 1000 + 250)); continue; }
        break;
      }
      if (!s?.success) throw new Error(`${player.name} could not be listed: ${s?.message || s?.error || 'refused'}`);
      this.recordListed?.({ accountId: seller, player, price: lp.price, currency: lp.currency, source: 'scout', from: owner });
      this._log('success', 'listed', { player: player.name, price: lp.price, currency: lp.currency }, `${player.name} listed · ${lp.price} ${lp.currency}`, seller);
    } finally {
      if (reg?.own) { try { reg.gs.close(); } catch {} }
      if (parked) await this._restoreParked(buyer, parked);
    }
  }

  // The parked copy back: off the market, equipment / skill / lineup back on (a fresh connection:
  // the one of the signing may be gone after a trade). Tried a few times while the new copy leaves.
  async _restoreParked(accountId, record) {
    let last = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let c = null;
      try {
        c = await this._reg(accountId);
        const os = new OwnedSwap({ gs: c.gs, userId: c.userId, log: (level, code, params, message) => this._osLog(level, code, params, `${record.name}: ${message}`, accountId) });
        last = await os.restore(record).catch(error => ({ ok: false, message: error.message }));
      } catch (error) { last = { ok: false, message: error.message }; }
      finally { if (c?.own) { try { c.gs.close(); } catch {} } }
      if (last?.ok) return;
      if (last?.reason !== 'copyInRoster') break;
      await sleepMs(3000);
    }
    this._log('error', 'ownedRestoreFailed', { player: record.name, error: last?.message || last?.reason || '?' }, `${record.name}: the original could not be brought back from the market (9,999,999 TIX) · ${last?.message || last?.reason || '?'}`, accountId);
  }

  // Side accounts to take Main's player: spenders first, then the other sides; never Main / the
  // second main, a busy account, a full roster or one that has the player already. Fewest players first.
  async _sideCandidates(mainId, playerId) {
    const prof = this.store.getAccountProfile?.() || {};
    const ids = this._accounts().filter(a => a.id !== mainId && a.id !== prof.secondMainId && this._userId(a.id) && !this.isBusy(a.id)).map(a => a.id);
    const info = await this._stats(ids);
    const ok = ids.filter(id => { const st = info.get(id); return st && st.total < 11 && !st.ids.has(playerId); });
    const role = id => (this._account(id)?.role === 'spender' ? 0 : 1);
    return ok.sort((a, b) => role(a) - role(b) || info.get(a).total - info.get(b).total);
  }

  // Main → side over a Trade Center room (Main hosts, the side joins and confirms). Returns the side.
  async _toSide(mainId, player) {
    const cands = (await this._sideCandidates(mainId, player.id)).slice(0, TRADE_TRIES);
    if (!cands.length) throw new Error('no side account with room');
    let lastError = null;
    for (const sideId of cands) {
      let m = null, sd = null, roomId = null;
      try {
        m = await TradeGameAccount.open({ account: this._account(mainId), sessions: this.sessions, createSocket: this.createSocket });
        sd = await TradeGameAccount.open({ account: this._account(sideId), sessions: this.sessions, createSocket: this.createSocket });
        const password = String(Math.floor(100000 + Math.random() * 900000));
        roomId = await m.createRoom('Scout', password);
        const hostJoined = m.expect('joinedRoomData', d => d?.roomId === roomId);
        const room = await sd.joinRoom(roomId, password);
        await hostJoined.catch(() => null);
        const sel = (room.hostPlayers || []).filter(p => p.id === player.id);
        if (!sel.length) throw new Error('the player is not on Main');
        const upd = sd.expect('tradeSelectionUpdate', d => d?.roomId === roomId && (d.hostSelectedPlayers || []).length === 1);
        m.select(roomId, sel);
        await upd;
        await sleepMs(300);
        for (let attempt = 1; ; attempt++) {
          const both = sd.expect('acceptTradeUpdate', d => d?.hostAccepted && d?.guestAccepted, 7000);
          m.accept(roomId);
          await sleepMs(250);
          sd.accept(roomId);
          try { await both; break; } catch (error) { if (attempt >= 3) throw error; }
        }
        const resultP = sd.expect('tradeResult', () => true).catch(error => ({ success: false, message: error.message }));
        sd.confirm(roomId, sel, []);
        const result = await resultP;
        const tr = (await sd.roster().catch(() => null))?.players || {};
        if (![...(tr.starters || []), ...(tr.bench || [])].some(p => p.id === player.id)) throw new Error(result?.message || 'the player did not move');
        m.cancelRoom(roomId); roomId = null;
        this.statCache?.delete(sideId);
        this.statCache?.delete(mainId);
        this._log('success', 'toSide', { player: player.name, side: this._name(sideId) }, `${player.name} · Main → ${this._name(sideId)} (it lists it)`, sideId);
        return sideId;
      } catch (error) {
        lastError = error;
      } finally {
        if (roomId) m?.cancelRoom(roomId);
        try { sd?.leave(); } catch {}
        sd?.close();
        m?.close();
      }
    }
    throw lastError || new Error('trade failed');
  }
}

module.exports = { ScoutHunter };
