const { GameSocket } = require('./game-socket.cjs');
const { WIDE, eachAtOnce, eachWithSocket } = require('./wide.cjs');

// Çanta (bag) page, starting with the X2 EXP props (user 2026-11-11). Read from the game client:
//   getUserInventory {userId} -> userInventoryData [{id (inventory id), itemId, quantity,
//     item{id, name, type 'PROPS', icon}}]   (no sign-in; live 2026-11-11: "X2 EXP(1DAY)" in
//     every account, the translations also name a "7DAYS X2 EXP")
//   useInventoryItem {userId, inventoryId, itemId} -> useInventoryItemResult {success, message}
//     (the bag's Use button; needs the account's registered connection)
//   xpBoostStatus {success, hasBoost, boostData{multiplier, remainingTime, type}} — pushed to a
//     registered connection; read when we sign in for a use or the status.
// The end of a boost we started is kept (use time + the item's days), so the page shows the
// time left without signing in again.
const READ_TIMEOUT_MS = 12000;
const STATUS_WAIT_MS = 4000;
const AUTH = /auth|user id is required|not authenticated|unauthor|register/i;
// Random player cards (user 2026-11-18): every kind of "Random A Card" / "Random S (Player) Card"
// (e.g. "Random S Player Card (3D)", "Random S+ Player Card"). The bag's Use opens one with the same
// useInventoryItem; the answer carries the new player ({success, message, player}).
// + the Base Salary player cards (user 2026-11-19): live name 'Base A Salary Card'; the client also
// says 'Base Salary S Player Card'. They open with the same useInventoryItem and give a player.
const isCard = name => { const n = String(name || ''); return /card/i.test(n) && (/random/i.test(n) || /base\s*[as]\+?\s*salary|base\s*salary\s*[as]\b/i.test(n)); };
// The game allows one use about every 2 s ("Please wait 2 seconds before trying again.", user
// 2026-11-20): keep the gap above it and, when it still says wait, wait that long and send again.
const OPEN_GAP_MS = 2300;
const WAIT_RE = /wait\s+(\d+(?:\.\d+)?)\s*(?:s\b|sec|second)/i;
const waitMsOf = msg => { const m = String(msg || '').match(WAIT_RE); return m ? Math.ceil(Number(m[1]) * 1000) + 600 : 0; };
const WAIT_TRIES = 5;
// The open answer's player may carry another id than the roster (or none): the roster's new
// players are matched to the opened ones by name, the rest in order.
function matchOpened(got, before, after) {
  const key = p => p?.id || p?.playerId || null;
  const nm = p => String(p?.visualName || p?.name || '').trim().toLowerCase();
  const fresh = before ? after.filter(p => key(p) && !before.has(key(p))) : [];
  const byId = new Map(after.map(p => [key(p), p]));
  const used = new Set();
  const out = [];
  const pending = [];
  for (const g of got) {
    let p = key(g.player) && byId.get(key(g.player));
    if (!p) p = fresh.find(x => !used.has(key(x)) && nm(x) && nm(x) === nm(g.player));
    if (!p && !before) p = after.find(x => !used.has(key(x)) && nm(x) && nm(x) === nm(g.player));
    if (p && !used.has(key(p))) { used.add(key(p)); out.push({ p, item: g.item }); } else pending.push(g);
  }
  // no name match: the remaining new roster players, in order
  for (const g of pending) {
    const p = fresh.find(x => !used.has(key(x)));
    if (p) { used.add(key(p)); out.push({ p, item: g.item }); }
  }
  return out;
}
const isXp = name => /x2 ?exp|2x ?exp|double ?(exp|xp)/i.test(String(name || ''));
// "X2 EXP(1DAY)" -> 1, "7DAYS X2 EXP" -> 7
const daysOf = name => Number(String(name || '').match(/(\d+)\s*DAYS?/i)?.[1]) || 1;
// remainingTime: ms or s (a day is 86 400 s / 86 400 000 ms)
const remainingMs = v => { const n = Number(v); if (!(n > 0)) return 0; return n > 10 * 24 * 3600 ? n : n * 1000; };

class BagService {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now(), parallel = WIDE, onCardPlayers = null }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, now, parallel, onCardPlayers });
    this.opening = {}; // accountId -> { running, done, total, error }
    this.onChanged = onChanged || (() => {});
    this.bags = {};      // accountId -> { items: [{ inventoryId, itemId, name, days, quantity }], readAt, error }
    this.busy = new Set();
    this.reading = false;
  }

  _accounts() { return (this.store.getAccounts?.() || []).filter(a => !a.signupPending); }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? (this._account(id)?.name || '') : '', taskName: 'Çanta', code: `bg.${code}`, params, message });
  }
  _boosts() { return this.store.getSettings?.()?.xpBoosts || {}; }
  _saveBoost(id, boost) {
    const s = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...s, xpBoosts: { ...(s.xpBoosts || {}), [id]: boost } });
  }

  snapshot() {
    const now = this.now();
    const boosts = {};
    for (const [id, b] of Object.entries(this._boosts())) if (b?.endsAt && Date.parse(b.endsAt) > now) boosts[id] = b;
    return { bags: JSON.parse(JSON.stringify(this.bags)), boosts, busy: [...this.busy], reading: this.reading, opening: JSON.parse(JSON.stringify(this.opening)) };
  }

  // Every account's X2 EXP props, a few connections at a time, no sign-in.
  async read(accountIds = null) {
    if (this.reading) return this.snapshot();
    const ids = (accountIds && accountIds.length ? accountIds : this._accounts().map(a => a.id)).filter(id => this._userId(id));
    this.reading = true;
    this.onChanged();
    try {
      await eachWithSocket(ids, () => GameSocket.open({ createSocket: this.createSocket }), (gs, id) => this._readOne(gs, id), {
        limit: this.parallel,
        onError: (id, error) => { this.bags[id] = { ...(this.bags[id] || {}), error: error.message, readAt: new Date(this.now()).toISOString() }; }
      });
    } finally {
      this.reading = false;
      this.onChanged();
    }
    return this.snapshot();
  }

  async _readOne(gs, id) {
    const d = await gs.call('getUserInventory', { userId: this._userId(id) }, 'userInventoryData', { timeoutMs: READ_TIMEOUT_MS });
    const list = Array.isArray(d) ? d : (d?.inventory || d?.items || []);
    const items = list.filter(x => isXp(x?.item?.name) && Number(x.quantity) > 0)
      .map(x => ({ inventoryId: x.id, itemId: x.itemId || x.item?.id, name: x.item.name, days: daysOf(x.item.name), quantity: Number(x.quantity) || 0 }));
    const cards = list.filter(x => isCard(x?.item?.name) && Number(x.quantity) > 0)
      .map(x => ({ inventoryId: x.id, itemId: x.itemId || x.item?.id, name: x.item.name, quantity: Number(x.quantity) || 0 }));
    this.bags[id] = { items, cards, readAt: new Date(this.now()).toISOString(), error: null };
  }

  // A connection that may write: another service's registered one when live, else the cookie;
  // `register` only when the game asks for it (that signs a game tab of the account out).
  async _conn(account) {
    const session = await this.sessions.get(account, { owner: 'bag' });
    const borrowed = GameSocket.borrow?.(session.userId);
    if (borrowed) return { gs: borrowed, userId: session.userId, own: false };
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader });
    return { gs, userId: session.userId, own: true, registered: false };
  }

  // Waits a moment for the boost the game pushes to a registered connection.
  _watchBoost(c) {
    let last = null;
    const on = d => { if (d && d.success !== false) last = d; };
    c.gs.socket.on('xpBoostStatus', on);
    return { stop: () => c.gs.socket.off('xpBoostStatus', on), get: () => last };
  }
  _boostFrom(d, fallbackDays) {
    if (!d) return null;
    if (!d.hasBoost) return { active: false };
    const ms = remainingMs(d.boostData?.remainingTime);
    return { active: true, multiplier: Number(d.boostData?.multiplier) || 2, endsAt: ms ? new Date(this.now() + ms).toISOString() : (fallbackDays ? new Date(this.now() + fallbackDays * 86400000).toISOString() : null), type: d.boostData?.type || null };
  }

  // Signs in to read the running boost (the time left of a boost used elsewhere).
  async status(accountId) {
    const account = this._account(accountId);
    if (!account) throw new Error('Account not found.');
    this.busy.add(accountId); this.onChanged();
    let c = null;
    try {
      c = await this._conn(account);
      const w = this._watchBoost(c);
      if (c.own) { await c.gs.register(c.userId, { owner: 'Çanta' }); c.registered = true; }
      c.gs.socket.emit('getUserDetails', { userId: c.userId });
      await new Promise(r => setTimeout(r, STATUS_WAIT_MS));
      w.stop();
      const b = this._boostFrom(w.get());
      if (b?.active) this._saveBoost(accountId, { ...b, readAt: new Date(this.now()).toISOString() });
      else if (b) this._saveBoost(accountId, null);
      return b;
    } finally {
      if (c?.own) { try { c.gs.close(); } catch {} }
      this.busy.delete(accountId); this.onChanged();
    }
  }

  // Uses one X2 EXP prop on each account (the shortest kind first unless one is named), all the
  // accounts at once.
  async use(accountIds, { itemId = null } = {}) {
    const out = {};
    await eachAtOnce([...new Set(accountIds || [])], async id => {
      try { out[id] = await this._useOne(id, itemId); }
      catch (error) { out[id] = { ok: false, error: error.message }; this._log(id, 'error', 'useFailed', { error: error.message }, `X2 EXP could not be used: ${error.message}`); }
    }, this.parallel);
    return { results: out, ...this.snapshot() };
  }

  async _useOne(id, itemId) {
    const account = this._account(id);
    if (!account) throw new Error('Account not found.');
    if (this.busy.has(id)) throw new Error('This account is busy, try again in a moment.');
    this.busy.add(id); this.onChanged();
    let c = null;
    try {
      // the bag as it is now (an inventory id from an old read may be gone)
      const anon = await GameSocket.open({ createSocket: this.createSocket });
      try { await this._readOne(anon, id); } finally { try { anon.close(); } catch {} }
      const items = (this.bags[id]?.items || []).filter(x => !itemId || x.itemId === itemId).sort((a, b) => a.days - b.days);
      const item = items[0];
      if (!item) throw new Error('No X2 EXP item in the bag.');
      c = await this._conn(account);
      const w = this._watchBoost(c);
      const send = () => c.gs.call('useInventoryItem', { userId: c.userId, inventoryId: item.inventoryId, itemId: item.itemId }, 'useInventoryItemResult', { timeoutMs: READ_TIMEOUT_MS });
      let r = await send().catch(error => ({ success: false, message: error.message }));
      if (!r?.success && c.own && !c.registered && AUTH.test(String(r?.message || r?.error || ''))) {
        await c.gs.register(c.userId, { owner: 'Çanta' });
        c.registered = true;
        r = await send().catch(error => ({ success: false, message: error.message }));
      }
      if (!r?.success) throw new Error(r?.message || r?.error || 'The game refused it.');
      await new Promise(res => setTimeout(res, 1500));
      w.stop();
      const pushed = this._boostFrom(w.get(), item.days);
      const boost = pushed?.active ? pushed : { active: true, multiplier: 2, endsAt: new Date(this.now() + item.days * 86400000).toISOString() };
      this._saveBoost(id, { ...boost, item: item.name, usedAt: new Date(this.now()).toISOString() });
      this._log(id, 'success', 'used', { item: item.name, until: boost.endsAt }, `${item.name} used · X2 EXP until ${boost.endsAt}`);
      const anon2 = await GameSocket.open({ createSocket: this.createSocket });
      try { await this._readOne(anon2, id); } finally { try { anon2.close(); } catch {} }
      return { ok: true, item: item.name, endsAt: boost.endsAt, message: r.message || '' };
    } finally {
      if (c?.own) { try { c.gs.close(); } catch {} }
      this.busy.delete(id); this.onChanged();
    }
  }

  async _roster(userId) {
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const r = await gs.ack('getTeamOptimized', { userId }, { timeoutMs: READ_TIMEOUT_MS });
      return [...(r?.players?.starters || []), ...(r?.players?.bench || [])];
    } finally { try { gs.close(); } catch {} }
  }

  // Opens the Random cards on every chosen account at once (user 2026-11-18). itemIds: the kinds to
  // open (all kinds when empty); count: at most this many per account (all when empty). The players
  // that come out go to the list of the Bag -> Random Card tab (Draft's list, source 'card'), with
  // Fire / To cards / List.
  async openCards({ accountIds, itemIds = [], count = null } = {}) {
    const out = {};
    const ids = [...new Set(accountIds || [])].filter(id => this._account(id));
    await eachAtOnce(ids, async id => {
      try { out[id] = await this._openOne(id, itemIds || [], Number(count) > 0 ? Number(count) : Infinity); }
      catch (error) {
        out[id] = { ok: false, error: error.message, players: [] };
        this.opening[id] = { ...(this.opening[id] || {}), running: false, error: error.message };
        this._log(id, 'error', 'cardFailed', { error: error.message }, `Random card could not be opened: ${error.message}`);
        this.onChanged();
      }
    }, this.parallel);
    return { results: out, ...this.snapshot() };
  }

  async _openOne(id, kinds, max) {
    const account = this._account(id);
    if (this.busy.has(id)) throw new Error('This account is busy, try again in a moment.');
    this.busy.add(id); this.onChanged();
    let c = null;
    const got = [];
    try {
      const anon = await GameSocket.open({ createSocket: this.createSocket });
      try { await this._readOne(anon, id); } finally { try { anon.close(); } catch {} }
      const items = (this.bags[id]?.cards || []).filter(x => !kinds.length || kinds.includes(x.itemId));
      const queue = [];
      for (const it of items) for (let i = 0; i < it.quantity && queue.length < max; i++) queue.push(it);
      if (!queue.length) throw new Error('No Random card of the chosen kinds in the bag.');
      this.opening[id] = { running: true, done: 0, total: queue.length, error: null, at: new Date(this.now()).toISOString() };
      this.onChanged();
      const userId = this._userId(id);
      const beforeList = await this._roster(userId).catch(() => null);
      const before = beforeList ? new Set(beforeList.map(p => p.id || p.playerId).filter(Boolean)) : null;
      c = await this._conn(account);
      let error = null;
      for (const item of queue) {
        const send = () => c.gs.call('useInventoryItem', { userId: c.userId, inventoryId: item.inventoryId, itemId: item.itemId }, 'useInventoryItemResult', { timeoutMs: READ_TIMEOUT_MS });
        let r = await send().catch(e => ({ success: false, message: e.message }));
        if (!r?.success && c.own && !c.registered && AUTH.test(String(r?.message || r?.error || ''))) {
          await c.gs.register(c.userId, { owner: 'Çanta' });
          c.registered = true;
          r = await send().catch(e => ({ success: false, message: e.message }));
        }
        for (let t = 0; t < WAIT_TRIES && !r?.success && waitMsOf(r?.message || r?.error); t++) {
          await new Promise(res => setTimeout(res, waitMsOf(r?.message || r?.error)));
          r = await send().catch(e => ({ success: false, message: e.message }));
        }
        if (!r?.success) { error = r?.message || r?.error || 'The game refused it.'; break; }
        const p = r.player || null;
        got.push({ item: item.name, player: p });
        this._log(id, 'success', 'cardOpened', { item: item.name, player: p?.visualName || p?.name || '?' }, `${item.name} opened · ${p?.visualName || p?.name || '?'}`);
        this.opening[id] = { ...this.opening[id], done: got.length };
        this.onChanged();
        await new Promise(res => setTimeout(res, OPEN_GAP_MS));
      }
      // the roster is the truth for salary / value / Base (the answer may carry less)
      let after = got.length ? await this._roster(userId).catch(() => []) : [];
      let matched = matchOpened(got, before, after);
      if (got.length && matched.length < got.length) {
        // the roster may lag a moment behind the open
        await new Promise(res => setTimeout(res, 2500));
        after = await this._roster(userId).catch(() => after);
        matched = matchOpened(got, before, after);
      }
      const rows = matched.map(m => rosterRow(m.p, m.item, this.now())).filter(r => r.id);
      if (rows.length) this.onCardPlayers?.(id, rows);
      if (rows.length < got.length) this._log(id, 'warning', 'cardNotListed', { n: got.length - rows.length }, `${got.length - rows.length} opened player(s) were not found in the roster, so they are not in the list`);
      this.opening[id] = { ...this.opening[id], running: false, done: got.length, error };
      if (error) this._log(id, 'warning', 'cardStopped', { done: got.length, total: queue.length, error }, `Random cards stopped at ${got.length}/${queue.length}: ${error}`);
      const anon2 = await GameSocket.open({ createSocket: this.createSocket });
      try { await this._readOne(anon2, id); } finally { try { anon2.close(); } catch {} }
      if (!got.length && error) throw new Error(error);
      return { ok: true, opened: got.length, total: queue.length, error, players: rows };
    } finally {
      if (c?.own) { try { c.gs.close(); } catch {} }
      if (this.opening[id]) this.opening[id].running = false;
      this.busy.delete(id); this.onChanged();
    }
  }
}

// A player from the roster (or the open answer) as a row of the Random Card list.
function rosterRow(p, item, now) {
  const n = v => (v == null || v === '' ? null : Number(v));
  return {
    id: p.id || p.playerId, name: p.visualName || p.name || '?', rating: p.rating || null, position: p.position || null,
    value: n(p.baseSalary ?? p.salary), salary: n(p.signedSalary ?? p.salary ?? p.baseSalary), base: n(p.newBaseSalary),
    item, source: 'card', at: new Date(now).toISOString(), listed: false
  };
}

module.exports = { BagService, isXp, isCard, daysOf, remainingMs, rosterRow, matchOpened, waitMsOf };
