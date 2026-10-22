const crypto = require('crypto');
const { GameSocket } = require('./game-socket.cjs');

// Buying from the Trading Hall and Auto Buy, over the game's /socket/:
//   market:buyPlayer {userId, ticketId}            -> market:buyResult {success, message, retryAfter (ms)}
//   market:sellPlayer {userId, playerId, price, paymentMode} -> market:sellResult {success, playerId}
//   market:cancelPlayerListing {userId, ticketId}  -> cancelResult {success, playerId}
//   market:getMyPlayerListings {userId, page, search, basePlayersOnly} -> market:myPlayerListingsData
//   market:getMarketPlayers {page, search, sort, paymentMode, basePlayersOnly} -> market:marketPlayersData (no login)
// Writes need `register {userId}` on the connection. The game wants at least 2 s
// between purchases and warns that faster clicking is "bannable": every purchase
// of this service (manual or automatic, any account) keeps BUY_GAP_MS apart.
const BUY_GAP_MS = 3000;
const WRITE_ATTEMPTS = 4;
const IDLE_CLOSE_MS = 60000;
const PARK_PRICE = 9999999;   // Auto Buy lists a bought player here until the user prices it
const PAYMENT_MODE = { APK: 'APK_TICKET', TIX: 'TICKET' };
const CURRENCY = { APK_TICKET: 'APK', TICKET: 'TIX' };
const DEFAULT_INTERVAL_SEC = 10;
const MAX_BOUGHT = 500;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
const finite = v => v !== '' && v != null && Number.isFinite(Number(v));

// A watch row is used only when both limits are set (all conditions must hold).
function rowReady(row) { return finite(row.maxPrice) && Number(row.maxPrice) >= 1 && finite(row.maxSalary) && Number(row.maxSalary) >= 0 && PAYMENT_MODE[row.currency]; }

// Listings of the watched player that satisfy every limit, cheapest first.
function matchingTickets(row, tickets, ownTeams = new Set()) {
  return (tickets || []).filter(t => (t.playerId || t.player?.id) === row.playerId
    && (!t.status || t.status === 'LISTED')
    && CURRENCY[t.paymentMode] === row.currency
    && Number(t.price) <= Number(row.maxPrice)
    && Number(t.signedSalary) <= Number(row.maxSalary)
    && !ownTeams.has(t.user?.teamName))
    .sort((a, b) => Number(a.price) - Number(b.price));
}

// First account in priority order that can pay `price`.
function pickAccount(order, balances, currency, price, skip = new Set()) {
  const key = currency === 'TIX' ? 'tix' : 'apk';
  return order.find(id => !skip.has(id) && Number(balances[id]?.[key]) >= price) || null;
}

// Currencies some account can still pay the cheapest limit of; empty = nothing left to buy.
function affordableCurrencies(rows, order, balances) {
  const out = new Set();
  for (const cur of ['APK', 'TIX']) {
    const limits = rows.filter(r => rowReady(r) && r.currency === cur).map(r => Number(r.maxPrice));
    if (!limits.length) continue;
    if (pickAccount(order, balances, cur, Math.min(...limits))) out.add(cur);
  }
  return out;
}

class BuyService {
  constructor({ store, activity, sessions, accountProfile, onChanged, onAttention, createSocket, now = () => Date.now(), timing = {} }) {
    this.store = store;
    this.activity = activity;
    this.sessions = sessions;
    this.accountProfile = accountProfile;
    this.onAttention = onAttention;
    this.createSocket = createSocket;
    this.now = now;
    this.timing = { buyGapMs: BUY_GAP_MS, idleCloseMs: IDLE_CLOSE_MS, ...timing };
    this.revision = 0;
    this.onChanged = () => { this.revision++; onChanged?.(); };
    this.conns = new Map();      // accountId -> { userId, socket, timer }
    this.lastBuyAt = 0;
    this.buyQueue = Promise.resolve();
    this.busy = {};              // ticketId / entryId -> true while working
    this.auto = { status: 'idle' };
    this.controller = null;
  }

  // ---------- data ----------
  _data() { return { version: 1, bought: [], watch: [], config: {}, ...(this.store.getBuyData?.() || {}) }; }
  _save(data) { this.store.saveBuyData?.(data); this.onChanged(); }
  _accounts() { return this.store.getAccounts(); }
  _name(id) { return this._accounts().find(a => a.id === id)?.name || id; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(level, code, params, message, accountId = null, taskName = 'Auto Buy') {
    this.activity.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName, code, params, message });
  }

  snapshot() {
    const d = this._data();
    return { bought: d.bought, watch: d.watch, config: { intervalSec: DEFAULT_INTERVAL_SEC, ...d.config }, auto: { ...this.auto }, busy: { ...this.busy }, parkPrice: PARK_PRICE };
  }

  // ---------- connections ----------
  async _conn(accountId, signal) {
    const held = this.conns.get(accountId);
    if (held?.socket?.socket?.connected) { this._touch(accountId); return held; }
    try { held?.socket?.close(); } catch {}
    const account = this._accounts().find(a => a.id === accountId);
    if (!account) throw new Error('Account not found.');
    const session = await this.sessions.get(account, { owner: 'buy' });
    const socket = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    await socket.register(session.userId, { signal });
    const conn = { accountId, userId: session.userId, socket, timer: null };
    this.conns.set(accountId, conn);
    this._touch(accountId);
    return conn;
  }
  // A registered connection signs the account out elsewhere, so it is closed soon after use.
  _touch(accountId) {
    const c = this.conns.get(accountId);
    if (!c) return;
    clearTimeout(c.timer);
    c.timer = setTimeout(() => this._close(accountId), this.timing.idleCloseMs);
    c.timer.unref?.();
  }
  _close(accountId) {
    const c = this.conns.get(accountId);
    if (!c) return;
    clearTimeout(c.timer);
    try { c.socket.close(); } catch {}
    this.conns.delete(accountId);
  }
  _closeAll() { for (const id of [...this.conns.keys()]) this._close(id); }

  async _write(conn, event, payload, replyEvent, signal) {
    let reply = null;
    let reregistered = false;
    for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
      this._touch(conn.accountId);
      reply = await conn.socket.call(event, payload, replyEvent, { signal, timeoutMs: 20000 });
      if (!reply?.success && !reregistered && /authentication required/i.test(reply?.message || '')) {
        reregistered = true;
        await conn.socket.register(conn.userId, { signal });
        continue;
      }
      const raw = Number(reply?.retryAfter ?? String(reply?.message || '').match(/wait (\d+)/i)?.[1]);
      if (reply?.success || !Number.isFinite(raw) || !/wait|cooldown|rate/i.test(reply?.message || 'wait')) return reply;
      // buyResult gives milliseconds, the other market writes seconds.
      await sleep((raw > 100 ? raw : raw * 1000) + 300, signal);
    }
    return reply;
  }

  async _balance(accountId, conn = null, signal = null) {
    const userId = conn?.userId || this._userId(accountId);
    if (!userId) return null;
    // A connection closed by the idle timer would never answer: read anonymously then.
    let socket = conn?.socket?.socket?.connected ? conn.socket : null;
    let temp = null;
    if (!socket) { temp = await GameSocket.open({ createSocket: this.createSocket, signal }); socket = temp; }
    try {
      const info = await socket.call('getUserBasicInfo', { userId }, 'userBasicInfo', { signal, timeoutMs: 10000 }).catch(() => null);
      if (!info?.success) return null;
      const bal = { apk: Number(info.autoPKTickets), tix: Number(info.ticket), tk: Number(info.funds) };
      const clean = Object.fromEntries(Object.entries(bal).filter(([, v]) => Number.isFinite(v)));
      this.accountProfile?.merge?.(accountId, clean);
      return clean;
    } finally { try { temp?.close(); } catch {} }
  }

  // ---------- buying ----------
  // Purchases (from any account) go one at a time with the game's cooldown between them.
  _queueBuy(fn) {
    const run = async () => {
      const wait = this.lastBuyAt + this.timing.buyGapMs - this.now();
      if (wait > 0) await sleep(wait);
      try { return await fn(); } finally { this.lastBuyAt = this.now(); }
    };
    const p = this.buyQueue.then(run, run);
    this.buyQueue = p.catch(() => {});
    return p;
  }

  // ticket: a Trading Hall row or a market ticket ({id, playerId, name, price, currency, salary, base, ...}).
  async buy(accountId, ticket, { source = 'hall', autoList = false, signal = null } = {}) {
    const t = normTicket(ticket);
    if (!t.id || !t.playerId) throw new Error('Listing not found.');
    if (this.busy[t.id]) throw new Error('This listing is already being bought.');
    this.busy[t.id] = true;
    this.onChanged();
    const task = source === 'auto' ? 'Auto Buy' : 'Trading Hall';
    try {
      return await this._queueBuy(async () => {
        const conn = await this._conn(accountId, signal);
        const r = await this._write(conn, 'market:buyPlayer', { userId: conn.userId, ticketId: t.id }, 'market:buyResult', signal);
        if (!r?.success) {
          const message = r?.message || 'unknown reply';
          this._log('warning', 'by.buyFailed', { name: t.name, price: t.price, currency: t.currency, error: message }, `${t.name} could not be bought · ${message}`, accountId, task);
          return { ok: false, message };
        }
        const data = this._data();
        const entry = { id: crypto.randomUUID(), accountId, playerId: t.playerId, name: t.name, position: t.position, grade: t.grade, salary: t.salary, base: t.base, boughtPrice: t.price, currency: t.currency, ticketId: t.id, source, boughtAt: new Date(this.now()).toISOString(), state: 'owned', listPrice: null, listCurrency: null };
        data.bought = [entry, ...data.bought].slice(0, MAX_BOUGHT);
        this._save(data);
        this._log('success', 'by.bought', { name: t.name, price: t.price, currency: t.currency }, `${t.name} bought · ${t.price} ${t.currency}`, accountId, task);
        await this._balance(accountId, conn, signal).catch(() => null);
        if (autoList) await this._sell(conn, entry.id, PARK_PRICE, 'TIX', signal, task).catch(error => this._log('warning', 'by.parkFailed', { name: t.name, error: error.message }, `${t.name} could not be listed: ${error.message}`, accountId, task));
        return { ok: true, entryId: entry.id };
      });
    } finally {
      delete this.busy[t.id];
      this.onChanged();
    }
  }

  // Bought player -> market at `price` / `currency`. If it is already listed (Auto Buy
  // parks it at 9,999,999 TIX) the listing is taken back first, like the Market relist.
  async sell(entryId, price, currency) {
    const entry = this._data().bought.find(e => e.id === entryId);
    if (!entry) throw new Error('Player not found in the bought list.');
    if (this.busy[entryId]) throw new Error('Already working on this player.');
    this.busy[entryId] = true;
    this.onChanged();
    try {
      const conn = await this._conn(entry.accountId);
      return await this._sell(conn, entryId, price, currency, null, entry.source === 'auto' ? 'Auto Buy' : 'Trading Hall');
    } finally { delete this.busy[entryId]; this.onChanged(); }
  }

  async _sell(conn, entryId, price, currency, signal, task) {
    const p = Math.round(Number(price));
    if (!(p >= 1)) throw new Error('Invalid price.');
    if (!PAYMENT_MODE[currency]) throw new Error('Invalid currency.');
    let entry = this._data().bought.find(e => e.id === entryId);
    if (entry.state === 'listed') {
      const listing = await this._findListing(conn, entry, signal);
      if (listing) {
        const removed = await this._write(conn, 'market:cancelPlayerListing', { userId: conn.userId, ticketId: listing.id }, 'cancelResult', signal);
        if (!removed?.success) {
          const message = removed?.message || 'unknown reply';
          this._log('warning', 'by.unlistFailed', { name: entry.name, error: message }, `${entry.name} could not be taken off the market · ${message}`, entry.accountId, task);
          throw new Error(message);
        }
      }
    }
    const r = await this._write(conn, 'market:sellPlayer', { userId: conn.userId, playerId: entry.playerId, price: p, paymentMode: PAYMENT_MODE[currency] }, 'market:sellResult', signal);
    const data = this._data();
    entry = data.bought.find(e => e.id === entryId);
    if (!r?.success) {
      entry.state = 'owned';
      this._save(data);
      const message = r?.message || 'unknown reply';
      this._log('error', 'by.sellFailed', { name: entry.name, error: message }, `${entry.name} could not be listed · ${message}`, entry.accountId, task);
      throw new Error(message);
    }
    Object.assign(entry, { state: 'listed', listPrice: p, listCurrency: currency, listedAt: new Date(this.now()).toISOString() });
    this._save(data);
    this._log('success', p === PARK_PRICE ? 'by.parked' : 'by.listed', { name: entry.name, price: p, currency }, `${entry.name} listed · ${p} ${currency}`, entry.accountId, task);
    return this.snapshot();
  }

  async _findListing(conn, entry, signal) {
    for (let page = 1; page <= 20; page++) {
      this._touch(conn.accountId);
      const d = await conn.socket.call('market:getMyPlayerListings', { userId: conn.userId, page, search: entry.name, basePlayersOnly: false }, 'market:myPlayerListingsData', { signal });
      const hit = (d?.tickets || []).find(t => t.playerId === entry.playerId && t.status === 'LISTED');
      if (hit) return hit;
      if ((d?.tickets || []).length < 8) return null;
    }
    return null;
  }

  removeBought(entryIds) {
    const ids = new Set(entryIds);
    const data = this._data();
    data.bought = data.bought.filter(e => !ids.has(e.id));
    this._save(data);
    return this.snapshot();
  }

  // ---------- Auto Buy list ----------
  addWatch(players) {
    const data = this._data();
    const have = new Set(data.watch.map(w => w.playerId));
    let added = 0;
    for (const p of players || []) {
      if (!p?.id || have.has(p.id)) continue;
      data.watch.push({ id: crypto.randomUUID(), playerId: p.id, name: p.name, team: p.team || null, position: p.position || null, rating: p.rating || null, value: p.value ?? null, base: p.base ?? null, maxSalary: '', maxPrice: '', currency: 'APK', enabled: true });
      have.add(p.id);
      added++;
    }
    this._save(data);
    return { added, snapshot: this.snapshot() };
  }
  updateWatch(id, patch) {
    const data = this._data();
    const row = data.watch.find(w => w.id === id);
    if (!row) throw new Error('Row not found.');
    for (const k of ['maxSalary', 'maxPrice', 'currency', 'enabled']) if (k in patch) row[k] = patch[k];
    this._save(data);
    return this.snapshot();
  }
  removeWatch(ids) {
    const s = new Set(ids);
    const data = this._data();
    data.watch = data.watch.filter(w => !s.has(w.id));
    this._save(data);
    return this.snapshot();
  }
  setConfig(patch) {
    const data = this._data();
    data.config = { ...data.config, ...patch };
    this._save(data);
    return this.snapshot();
  }

  // ---------- Auto Buy loop ----------
  async startAuto({ accountIds, intervalSec } = {}) {
    if (this.controller) throw new Error('Auto Buy is already running.');
    const order = (accountIds || []).filter(id => this._accounts().some(a => a.id === id));
    if (!order.length) throw new Error('Select at least one account.');
    const rows = this._data().watch.filter(r => r.enabled !== false && rowReady(r));
    if (!rows.length) throw new Error('Fill in Salary ≤, Price ≤ and the currency for at least one player.');
    const interval = Math.max(3, Math.min(600, Math.round(Number(intervalSec) || DEFAULT_INTERVAL_SEC)));
    this.setConfig({ accountOrder: order, intervalSec: interval });
    this.controller = new AbortController();
    this.auto = { status: 'running', startedAt: new Date(this.now()).toISOString(), cycle: 0, bought: 0, spent: { APK: 0, TIX: 0 }, balances: {}, lastScanAt: null, nextScanAt: null, message: null };
    this._log('info', 'ab.start', { rows: rows.length, accounts: order.length }, `Auto Buy started · ${rows.length} player(s) · ${order.length} account(s)`);
    this.onChanged();
    this.done = this._autoLoop(order, interval, this.controller.signal)
      .catch(error => {
        if (error?.name === 'AbortError') { this.auto.status = 'stopped'; this._log('warning', 'ab.stopped', {}, 'Auto Buy stopped'); return; }
        this.auto.status = 'error';
        this.auto.message = error.message;
        this._log('error', 'ab.failed', { error: error.message }, `Auto Buy stopped: ${error.message}`);
        this.onAttention?.('buyError', error.message);
      })
      .finally(() => { this.controller = null; this.auto.nextScanAt = null; this._closeAll(); try { this.anon?.close(); } catch {} this.anon = null; this.onChanged(); });
    return this.snapshot();
  }

  stopAuto() { this.controller?.abort(); return this.snapshot(); }

  async _anonSocket(signal) {
    if (this.anon?.socket?.connected) return this.anon;
    try { this.anon?.close(); } catch {}
    this.anon = await GameSocket.open({ createSocket: this.createSocket, signal });
    return this.anon;
  }

  async _autoLoop(order, interval, signal) {
    const balances = {};
    for (const id of order) balances[id] = await this._balance(id, null, signal).catch(() => null) || { apk: 0, tix: 0 };
    this.auto.balances = balances;
    const failedTickets = new Set();
    const ownTeams = new Set(this._accounts().map(a => a.name));
    for (;;) {
      if (signal.aborted) throw abortError();
      const rows = this._data().watch.filter(r => r.enabled !== false && rowReady(r));
      const ok = affordableCurrencies(rows, order, balances);
      if (!rows.length || !ok.size) {
        const currencies = [...new Set(rows.map(r => r.currency))].join(' / ') || 'APK';
        this.auto.status = 'noFunds';
        this.auto.message = currencies;
        this._log('error', 'ab.noFunds', { currency: currencies }, `Auto Buy stopped · the accounts do not have enough ${currencies}`);
        this.onAttention?.('buyNoFunds', currencies);
        return;
      }
      this.auto.cycle += 1;
      this.onChanged();
      const anon = await this._anonSocket(signal);
      for (const row of rows) {
        if (signal.aborted) throw abortError();
        if (!ok.has(row.currency)) continue;
        const reply = await anon.call('market:getMarketPlayers', { page: 1, search: row.name, sort: 'asc', paymentMode: PAYMENT_MODE[row.currency], basePlayersOnly: false }, 'market:marketPlayersData', { signal, timeoutMs: 15000 }).catch(() => null);
        for (const ticket of matchingTickets(row, reply?.tickets, ownTeams)) {
          if (failedTickets.has(ticket.id)) continue;
          const price = Number(ticket.price);
          const tried = new Set();
          const reasons = new Set();
          let bought = false;
          let gone = false;
          for (;;) {
            const accountId = pickAccount(order, balances, row.currency, price, tried);
            if (!accountId) break;
            tried.add(accountId);
            const r = await this.buy(accountId, ticketFromMarket(ticket), { source: 'auto', autoList: true, signal }).catch(error => ({ ok: false, message: error.message }));
            const fresh = await this._balance(accountId, this.conns.get(accountId), signal).catch(() => null);
            if (fresh) balances[accountId] = fresh;
            if (r.ok) {
              this.auto.bought += 1;
              this.auto.spent[row.currency] += price;
              bought = true;
              break;
            }
            // Someone else was faster / the listing is gone: never retry this ticket.
            if (/not found|no longer|already sold|not available|sold/i.test(r.message || '')) { gone = true; break; }
            // "already own this player", not enough funds, roster full: try the next account.
            reasons.add(/already own/i.test(r.message || '') ? 'owned' : /insufficient|not enough|balance|fund/i.test(r.message || '') ? 'funds' : 'other');
          }
          if (bought) continue;
          failedTickets.add(ticket.id);
          if (gone) continue;
          // No account could buy it (they already own the player and/or cannot pay):
          // warn right away, keep scanning for the other players. Once per listing.
          if (!tried.size) reasons.add('funds');
          const why = [...reasons].join('+');
          const words = { owned: ['kadroda var', 'already owned'], funds: ['bakiye yetersiz', 'not enough funds'], other: ['diğer', 'other'] };
          const reasonTr = [...reasons].map(r => words[r][0]).join(' + ');
          const reasonEn = [...reasons].map(r => words[r][1]).join(' + ');
          this.auto.lastWarning = { name: row.name, price, currency: row.currency, reason: why, reasonTr, reasonEn, at: new Date(this.now()).toISOString() };
          this._log('error', 'ab.cannotBuy', { name: row.name, price, currency: row.currency, reason: why, reasonTr, reasonEn, tried: tried.size }, `No account could buy ${row.name} (${price} ${row.currency}) · ${why}`);
          this.onAttention?.('buyCannot', `${row.name} · ${price} ${row.currency}`);
          this.onChanged();
          if (!tried.size) break; // nobody can pay this or a pricier listing
        }
        this.auto.balances = { ...balances };
        this.onChanged();
      }
      this.auto.lastScanAt = new Date(this.now()).toISOString();
      this.auto.nextScanAt = new Date(this.now() + interval * 1000).toISOString();
      this.onChanged();
      await sleep(interval * 1000, signal);
    }
  }

  async shutdown() { this.controller?.abort(); await this.done?.catch(() => {}); this._closeAll(); }
}

function normTicket(t) {
  return { id: t.id || t.ticketId, playerId: t.playerId, name: t.name, position: t.position || null, grade: t.grade || t.rating || null, salary: t.salary ?? null, base: t.base ?? null, price: Number(t.price), currency: t.currency };
}
function ticketFromMarket(t) {
  const p = t.player || {};
  return { id: t.id, playerId: t.playerId || p.id, name: String(p.visualName || p.name || '').trim(), position: p.position || null, grade: p.rating || null, salary: Number(t.signedSalary), base: Number(p.newBaseSalary) || null, price: Number(t.price), currency: CURRENCY[t.paymentMode] };
}

module.exports = { BuyService, rowReady, matchingTickets, pickAccount, affordableCurrencies, PARK_PRICE };
