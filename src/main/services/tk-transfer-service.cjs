const crypto = require('crypto');
const { TradeGameAccount, sleep, abortError } = require('./trade-game-client.cjs');
const R = require('./trade-rules.cjs');

// TK transfer (user rules 2026-10-25): moves TK from side accounts to the main account
// without spending TK. One round with one side account:
//   1. main buys up to 5 of the side's own APK listings on the market
//      (price ≤ max APK, salary ≥ min salary, never a player main already owns, never two
//      copies of one player) — main pays APK, the side's sale is claimed;
//   2. trade: the side hosts a room, main gives those players back, the side gives nothing
//      → the side pays main their salary sum in TK (the game's trade rule);
//   3. the side lists the same players again at the same APK price.
// Sides go in TK order (highest first, re-sorted every round). It stops when the TK
// target is passed, when main's APK runs out, or when no side has a usable listing.
// Game events: market:getMyPlayerListings / market:buyPlayer / market:settleTicket /
// market:sellPlayer, getTeamOptimized, getUserBasicInfo, Trade Center (trade-game-client).
const ROUND_MAX = 5;
const BUY_GAP_MS = 3000;          // the game wants ≥ 2 s between purchases
const PAGE_SIZE = 8;
const ACCEPT_WAIT_MS = 7000;
const ACCEPT_TRIES = 3;
const MAX_ROUNDS = 500;
const ROOM_DESCRIPTION = 'TK';

const sameIds = (a, b) => (a || []).length === (b || []).length && (a || []).every(x => (b || []).some(y => y?.id === x?.id));

function normalizeConfig(raw = {}) {
  const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
  return {
    mainId: raw.mainId || null,
    sideIds: [...new Set((raw.sideIds || []).filter(Boolean))].filter(id => id !== raw.mainId),
    minSalary: Math.min(2500, Math.max(0, int(raw.minSalary, 0))),
    maxApk: Math.max(20, int(raw.maxApk, 20)),
    targetTk: Math.max(1, int(raw.targetTk, 50000))
  };
}

// A side's listings main may buy now, best first (more salary = more TK per round).
function pickListings(listings, { minSalary, maxApk, mainOwned, count, sideFunds }) {
  const seen = new Set();
  const out = [];
  let salary = 0;
  const usable = listings
    .filter(t => t.status === 'LISTED' && t.currency === 'APK' && t.price <= maxApk && t.salary >= minSalary && t.playerId && !mainOwned.has(t.playerId))
    .sort((a, b) => b.salary - a.salary || a.price - b.price);
  for (const t of usable) {
    if (out.length >= count) break;
    if (seen.has(t.playerId)) continue;
    if (salary + t.salary > sideFunds) continue;
    seen.add(t.playerId);
    out.push(t);
    salary += t.salary;
  }
  return out;
}

function ticketRow(t) {
  const p = t?.player || {};
  return {
    ticketId: t.id, playerId: t.playerId || p.id || null,
    name: String(p.visualName || p.name || '?').trim(),
    salary: Number(t.signedSalary) || 0, price: Number(t.price) || 0,
    currency: t.paymentMode === 'APK_TICKET' ? 'APK' : t.paymentMode === 'TICKET' ? 'TIX' : t.paymentMode,
    status: t.status || null
  };
}

class TkTransferService {
  constructor({ store, activity, sessions, onChanged, createSocket, now = () => Date.now(), timing = {} }) {
    Object.assign(this, { store, activity, sessions, createSocket, now });
    this.onChanged = onChanged || (() => {});
    this.timing = { buyGapMs: BUY_GAP_MS, ...timing };
    this.controller = null;
    this.run = null;
  }

  snapshot() {
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, config: this.store.getSettings?.()?.tkTransfer || null, lastReport: this.store.getSettings?.()?.tkTransferReport || null };
  }
  stop() { this.controller?.abort(); }
  _account(id) { return this.store.getAccounts().find(a => a.id === id) || null; }
  _name(id) { return this._account(id)?.name || id; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'TK Transfer', code: `tk.${code}`, params, message });
  }
  _row(id, patch) { Object.assign(this.run.accounts[id], patch); this.onChanged(); }
  _step(step, params = {}) { this.run.step = step; this.run.stepParams = params; this.onChanged(); }

  saveConfig(raw) {
    const config = normalizeConfig(raw);
    const settings = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...settings, tkTransfer: config });
    this.onChanged();
    return config;
  }

  validate(raw) {
    const c = normalizeConfig(raw);
    const ids = new Set(this.store.getAccounts().map(a => a.id));
    if (!c.mainId || !ids.has(c.mainId)) throw new Error('Choose the main account.');
    if (!c.sideIds.filter(id => ids.has(id)).length) throw new Error('Choose at least one side account.');
    const n = v => Number(v);
    if (!Number.isInteger(n(raw.minSalary)) || n(raw.minSalary) < 0 || n(raw.minSalary) > 2500) throw new Error('Minimum salary must be a whole number between 0 and 2500.');
    if (!Number.isInteger(n(raw.maxApk)) || n(raw.maxApk) < 20) throw new Error('Maximum APK must be a whole number, at least 20.');
    if (!Number.isInteger(n(raw.targetTk)) || n(raw.targetTk) < 1) throw new Error('Enter the TK to transfer.');
    return c;
  }

  async runAndWait(raw, { signal } = {}) {
    if (this.controller) throw new Error('TK transfer is already running.');
    const config = this.validate(raw);
    this.saveConfig(config);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.controller = controller;
    const accounts = {};
    for (const id of [config.mainId, ...config.sideIds]) accounts[id] = { accountId: id, name: this._name(id), main: id === config.mainId, funds: null, apk: null, bought: 0, apkSpent: 0, tk: 0, rounds: 0, relisted: 0, status: 'queued', note: null };
    this.run = { startedAt: new Date(this.now()).toISOString(), config, accounts, transferred: 0, apkSpent: 0, rounds: 0, step: 'starting', stepParams: {}, result: null, items: [] };
    this._log(null, 'info', 'start', { main: this._name(config.mainId), sides: config.sideIds.length, target: config.targetTk }, `TK transfer started · main ${this._name(config.mainId)} · ${config.sideIds.length} side account(s) · target ${config.targetTk} TK`);
    this.onChanged();
    const conns = new Map();
    let result = null;
    try {
      result = await this._go(config, conns, controller.signal);
    } catch (error) {
      result = error?.name === 'AbortError' ? { reason: 'stopped' } : { reason: 'error', error: error.message };
      if (result.reason === 'error') this._log(null, 'error', 'failed', { error: error.message }, `TK transfer stopped: ${error.message}`);
    } finally {
      for (const c of conns.values()) c.close();
      signal?.removeEventListener('abort', onAbort);
      this.run.result = result;
      this._report(result);
      this.controller = null;
      this.onChanged();
    }
    if (signal?.aborted) throw abortError();
    return this.snapshot();
  }

  async _conn(conns, id, signal) {
    if (conns.has(id)) return conns.get(id);
    this._row(id, { status: 'login' });
    const c = await TradeGameAccount.open({ account: this._account(id), sessions: this.sessions, createSocket: this.createSocket, signal });
    conns.set(id, c);
    this._row(id, { status: 'ready' });
    return c;
  }

  async _balance(c) {
    const info = await c.conn.call('getUserBasicInfo', { userId: c.userId }, 'userBasicInfo', { signal: c.signal, timeoutMs: 20000 });
    return { tk: Number(info?.funds), apk: Number(info?.autoPKTickets) };
  }

  async _listings(c) {
    const page = n => c.conn.call('market:getMyPlayerListings', { userId: c.userId, page: n, search: '', basePlayersOnly: false }, 'market:myPlayerListingsData', { signal: c.signal, timeoutMs: 20000 });
    const first = await page(1);
    const pages = Math.max(1, Math.ceil(Number(first?.total || 0) / PAGE_SIZE));
    const rows = (first?.tickets || []).map(ticketRow);
    for (let n = 2; n <= pages; n++) rows.push(...((await page(n))?.tickets || []).map(ticketRow));
    const seen = new Set();
    return rows.filter(r => !seen.has(r.ticketId) && seen.add(r.ticketId));
  }

  // Market write with the game's "please wait" handling.
  async _write(c, event, payload, reply) {
    for (let attempt = 0; ; attempt++) {
      const r = await c.conn.call(event, payload, reply, { signal: c.signal, timeoutMs: 20000 });
      const raw = Number(r?.retryAfter ?? String(r?.message || '').match(/wait (\d+)/i)?.[1]);
      if (r?.success || !Number.isFinite(raw) || attempt >= 4) return r;
      await sleep((raw > 100 ? raw : raw * 1000) + 300, c.signal);
    }
  }

  async _go(config, conns, signal) {
    const main = await this._conn(conns, config.mainId, signal);
    const blocked = new Set();          // sides with nothing usable right now
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (this.run.transferred >= config.targetTk) return { reason: 'target' };
      // main: room in the roster, APK, owned players
      const mainRoster = R.rosterOf(await main.roster());
      const mainBal = await this._balance(main);
      this._row(config.mainId, { funds: mainBal.tk, apk: mainBal.apk, status: 'ready' });
      const mainFree = R.ROSTER_MAX - mainRoster.total;
      if (mainFree <= 0) throw new Error(`The roster of ${this._name(config.mainId)} is full (${R.ROSTER_MAX}).`);
      // sides in TK order (highest first)
      this._step('order');
      const sides = [];
      for (const id of config.sideIds) {
        if (blocked.has(id)) continue;
        const c = await this._conn(conns, id, signal).catch(error => { this._row(id, { status: 'error', note: error.message }); this._log(id, 'warning', 'loginFailed', { error: error.message }, `Could not connect: ${error.message}`); blocked.add(id); return null; });
        if (!c) continue;
        const bal = await this._balance(c).catch(() => ({ tk: NaN, apk: NaN }));
        this._row(id, { funds: bal.tk, apk: bal.apk });
        if (Number.isFinite(bal.tk)) sides.push({ id, c, tk: bal.tk });
      }
      sides.sort((a, b) => b.tk - a.tk);
      let did = false;
      let apkShort = false;
      for (const side of sides) {
        this._step('reading', { side: this._name(side.id) });
        const listings = await this._listings(side.c);
        const sideRoster = R.rosterOf(await side.c.roster());
        const room = Math.min(ROUND_MAX, mainFree, R.ROSTER_MAX - sideRoster.total);
        let picks = pickListings(listings, { minSalary: config.minSalary, maxApk: config.maxApk, mainOwned: mainRoster.ids, count: room, sideFunds: side.tk });
        if (!picks.length) {
          const any = listings.some(t => t.status === 'LISTED' && t.currency === 'APK' && t.price <= config.maxApk && t.salary >= config.minSalary && !mainRoster.ids.has(t.playerId));
          this._row(side.id, { status: 'idle', note: any ? (room <= 0 ? 'roomFull' : 'noTk') : 'noListings' });
          blocked.add(side.id);
          continue;
        }
        // only what main's APK pays for
        let apk = mainBal.apk;
        picks = picks.filter(t => (apk >= t.price ? ((apk -= t.price), true) : false));
        if (!picks.length) { apkShort = true; continue; }
        const r = await this._round(config, main, side, picks, signal);
        if (r.bought > 0) did = true;
        if (r.apkOut && !r.bought) { apkShort = true; continue; }
        if (this.run.transferred >= config.targetTk) return { reason: 'target' };
        break; // re-read balances and the TK order after every round
      }
      if (!did) return { reason: apkShort ? 'apk' : 'noListings' };
    }
    return { reason: 'limit' };
  }

  // One side: buy, trade back, relist.
  async _round(config, main, side, picks, signal) {
    const sid = side.id;
    const mid = config.mainId;
    this.run.rounds++;
    this._row(sid, { status: 'buying', rounds: this.run.accounts[sid].rounds + 1 });
    // every player of this round with its own status, shown live on the page
    const items = picks.map(t => ({ round: this.run.rounds, side: this._name(sid), name: t.name, salary: t.salary, price: t.price, status: 'toBuy', error: null }));
    this.run.items = [...items, ...this.run.items].slice(0, 300);
    const mark = (list, status, error = null) => { for (const it of list) Object.assign(it, { status, error }); this.onChanged(); };
    const itemOf = t => items[picks.indexOf(t)];
    this.onChanged();
    const bought = [];
    let apkOut = false;
    for (const t of picks) {
      if (apkOut) { mark([itemOf(t)], 'skipped'); continue; }
      this._step('buying', { side: this._name(sid), name: t.name, n: bought.length + 1, of: picks.length });
      mark([itemOf(t)], 'buying');
      const r = await this._write(main, 'market:buyPlayer', { userId: main.userId, ticketId: t.ticketId }, 'market:buyResult');
      if (r?.success) {
        mark([itemOf(t)], 'bought');
        bought.push(t);
        this.run.apkSpent += t.price;
        this.run.accounts[mid].apkSpent += t.price;
        this.run.accounts[mid].bought++;
      } else {
        const msg = String(r?.message || r?.error || 'refused');
        mark([itemOf(t)], 'buyFailed', msg);
        this._log(mid, 'warning', 'buyFailed', { name: t.name, price: t.price, error: msg }, `${t.name} could not be bought (${t.price} APK): ${msg}`);
        if (/apk|ticket|insufficient|not enough|balance/i.test(msg)) { apkOut = true; continue; }
      }
      await sleep(this.timing.buyGapMs, signal);
    }
    if (!bought.length) { this._row(sid, { status: 'idle' }); return { bought: 0, apkOut }; }
    // the side's sales: claim the APK
    for (const t of bought) {
      const r = await this._write(side.c, 'market:settleTicket', { ticketId: t.ticketId }, 'market:settleResult').catch(() => null);
      if (!r?.success) this._log(sid, 'warning', 'claimFailed', { name: t.name, error: String(r?.message || 'refused') }, `${t.name}: the sale could not be claimed · ${r?.message || 'refused'}`);
    }
    // trade the players back
    this._row(sid, { status: 'trading' });
    this._step('trading', { side: this._name(sid), n: bought.length });
    const boughtItems = bought.map(itemOf);
    mark(boughtItems, 'trading');
    const before = await this._balance(main).catch(() => ({ tk: NaN }));
    let traded = await this._trade(main, side.c, bought, signal);
    if (!traded.success) {
      this._log(sid, 'warning', 'tradeRetry', { error: traded.message }, `Trade failed, trying once more: ${traded.message}`);
      await sleep(2000, signal);
      traded = await this._trade(main, side.c, bought, signal);
    }
    if (!traded.success) mark(boughtItems, 'tradeFailed', traded.message);
    if (!traded.success) throw new Error(`Trade with ${this._name(sid)} failed: ${traded.message}. The bought players are on ${this._name(mid)}.`);
    mark(boughtItems, 'traded');
    const after = await this._balance(main).catch(() => ({ tk: NaN }));
    const salary = bought.reduce((n, t) => n + t.salary, 0);
    const tk = Number.isFinite(after.tk) && Number.isFinite(before.tk) && after.tk > before.tk ? after.tk - before.tk : salary;
    this.run.transferred += tk;
    this.run.accounts[sid].tk += tk;
    this.run.accounts[sid].bought += bought.length;
    this.run.accounts[sid].apkSpent += bought.reduce((n, t) => n + t.price, 0);
    this._row(mid, { funds: after.tk });
    this._log(sid, 'success', 'round', { n: bought.length, apk: bought.reduce((n, t) => n + t.price, 0), tk, total: this.run.transferred }, `${bought.length} player(s) bought for ${bought.reduce((n, t) => n + t.price, 0)} APK and traded back · +${tk} TK · ${this.run.transferred} TK so far`);
    // list them again at the same price
    this._row(sid, { status: 'listing' });
    for (const t of bought) {
      this._step('listing', { side: this._name(sid), name: t.name });
      mark([itemOf(t)], 'listing');
      const r = await side.c.sell(t.playerId, t.price, 'APK').catch(error => ({ success: false, message: error.message }));
      mark([itemOf(t)], r?.success ? 'relisted' : 'relistFailed', r?.success ? null : String(r?.message || 'refused'));
      if (r?.success) this.run.accounts[sid].relisted++;
      else this._log(sid, 'warning', 'relistFailed', { name: t.name, price: t.price, error: String(r?.message || 'refused') }, `${t.name} could not be listed again at ${t.price} APK: ${r?.message || 'refused'}`);
    }
    this._row(sid, { status: 'ready' });
    return { bought: bought.length, apkOut };
  }

  // The side hosts, main (guest) gives `players`, the side gives nothing.
  async _trade(main, side, players, signal) {
    const password = String(crypto.randomInt(10000000, 99999999));
    let roomId = null;
    try {
      roomId = await side.createRoom(ROOM_DESCRIPTION, password);
      const sideJoined = side.expect('joinedRoomData', d => d?.roomId === roomId);
      const room = await main.joinRoom(roomId, password);
      await sideJoined.catch(() => null);
      const sel = players.map(p => (room.guestPlayers || []).find(x => x.id === p.playerId));
      if (sel.some(x => !x)) return { success: false, message: 'A bought player is not offered in the trade room.' };
      const upd = main.expect('tradeSelectionUpdate', d => d?.roomId === roomId && sameIds(d.guestSelectedPlayers, sel));
      main.select(roomId, sel);
      await upd;
      await sleep(300, signal);
      for (let attempt = 1; ; attempt++) {
        const both = main.expect('acceptTradeUpdate', d => d?.hostAccepted && d?.guestAccepted, ACCEPT_WAIT_MS);
        side.accept(roomId);
        await sleep(250, signal);
        main.accept(roomId);
        try { await both; break; } catch (error) { if (attempt >= ACCEPT_TRIES) throw error; }
      }
      const resultP = main.expect('tradeResult', () => true);
      main.confirm(roomId, [], sel);
      const result = await resultP;
      return { success: Boolean(result?.success), message: result?.message || '' };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return { success: false, message: error.message };
    } finally {
      if (roomId) side.cancelRoom(roomId);
      main.leave();
    }
  }

  _report(result) {
    const r = this.run;
    const report = { startedAt: r.startedAt, finishedAt: new Date(this.now()).toISOString(), config: r.config, transferred: r.transferred, apkSpent: r.apkSpent, rounds: r.rounds, reason: result?.reason || 'error', error: result?.error || null, accounts: Object.values(r.accounts).map(a => ({ ...a })), items: r.items.map(i => ({ ...i })) };
    const settings = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...settings, tkTransferReport: report });
    const params = { tk: r.transferred, apk: r.apkSpent, rounds: r.rounds, target: r.config.targetTk };
    const lines = {
      target: ['success', 'doneTarget', `TK transfer finished · ${r.transferred} TK transferred (target ${r.config.targetTk}) · ${r.apkSpent} APK spent · ${r.rounds} round(s)`],
      apk: ['warning', 'apkOut', `APK ran out · TK transfer stopped · ${r.transferred} TK transferred · ${r.apkSpent} APK spent`],
      noListings: ['warning', 'noListings', `No usable listing left on the side accounts · TK transfer stopped · ${r.transferred} TK transferred · ${r.apkSpent} APK spent`],
      stopped: ['info', 'stopped', `TK transfer stopped · ${r.transferred} TK transferred · ${r.apkSpent} APK spent`],
      limit: ['warning', 'stopped', `TK transfer stopped · ${r.transferred} TK transferred · ${r.apkSpent} APK spent`],
      error: ['error', 'summaryError', `TK transfer stopped with an error · ${r.transferred} TK transferred · ${r.apkSpent} APK spent`]
    }[report.reason] || ['info', 'stopped', ''];
    this._log(null, lines[0], lines[1], params, lines[2]);
  }
}

module.exports = { TkTransferService, pickListings, normalizeConfig };
