const crypto = require('crypto');
const { TradeGameAccount, sleep, abortError } = require('./trade-game-client.cjs');
const { listingRow } = require('./market-service.cjs');
const R = require('./trade-rules.cjs');
const { GameSocket } = require('./game-socket.cjs');
const { eachWithSocket } = require('./wide.cjs');

// APK / TIX transfer (user 2026-11-07): moves the APK and/or TIX of side accounts to one account
// (main, or the account chosen to act as main) through the market:
//   1. every chosen account's market is read and its sales are claimed (the claimed players are
//      shown like the Market page's "Sold" table); then every balance is read;
//   2. sides with at least the minimum (APK / TIX) are eligible; each eligible side gets one
//      cheap player (salary ≤ max TK) of main listed for exactly its balance — the player for
//      each side and currency is fixed in advance, so sides with the same balance never mix up;
//   3. the cheap players come from main's own Scout (never Callback), then the Scouts of main's
//      friends, then the spender (Harcayıcı) accounts, one by one (their own Scout and their
//      friends' Scouts), which trade them to main. Main lists every player right away, so its
//      roster never fills up whatever the number of sides;
//   4. all sides buy their own listing at the same time (the ticket is checked: main's, the
//      planned player, the planned price); then main claims the sales (the game keeps
//      max(3, 5%) as the fee) and every balance is read again.
// Players with a role on the Cards page are never used (they belong to Auto Trade).
// Game events: market:getMyPlayerListings / market:settleTicket / market:sellPlayer /
// market:buyPlayer, getFreeAgent / signFreeAgent, getFriendFreeAgents / signFriendFreeAgent,
// getUserBasicInfo, Trade Center (trade-game-client).
const { pageSizeOf, pageCount, isLastPage } = require('./market-pages.cjs');
// every account at once (user 2026-11-17: "4 er 4 er"); sockets are cheap, see wide.cjs
const CONCURRENCY = 200;
const ACCEPT_WAIT_MS = 7000;
const ACCEPT_TRIES = 3;
const TRADE_BATCH = 5;
const CURRENCIES = { APK: { mode: 'APK_TICKET', key: 'apk' }, TIX: { mode: 'TICKET', key: 'tix' } };

const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
const sameIds = (a, b) => (a || []).length === (b || []).length && (a || []).every(x => (b || []).some(y => y?.id === x?.id));

function normalizeConfig(raw = {}) {
  const mode = ['APK', 'TIX', 'both'].includes(raw.mode) ? raw.mode : 'APK';
  return {
    mainId: raw.mainId || null,
    sideIds: [...new Set((raw.sideIds || []).filter(Boolean))].filter(id => id !== raw.mainId),
    mode,
    minApk: Math.max(1, int(raw.minApk, 100)),
    minTix: Math.max(1, int(raw.minTix, 100)),
    maxTk: Math.min(2500, Math.max(1, int(raw.maxTk, 50))),
    useSpenders: raw.useSpenders !== false
  };
}
const currenciesOf = mode => (mode === 'both' ? ['APK', 'TIX'] : [mode]);

// Which sides get a transfer: one per side and currency, at its whole balance.
function planTransfers(sides, config) {
  const out = [];
  const skipped = [];
  for (const s of sides) {
    for (const cur of currenciesOf(config.mode)) {
      const have = Number(s[CURRENCIES[cur].key]);
      const min = cur === 'APK' ? config.minApk : config.minTix;
      if (!Number.isFinite(have)) { skipped.push({ sideId: s.id, currency: cur, reason: 'noBalance' }); continue; }
      if (have < min) { skipped.push({ sideId: s.id, currency: cur, reason: 'belowMin', have, min }); continue; }
      out.push({ id: crypto.randomUUID(), sideId: s.id, currency: cur, price: Math.floor(have) });
    }
  }
  // a side needs a free roster place for every player it buys
  for (const s of sides) {
    const mine = out.filter(t => t.sideId === s.id);
    const room = Math.max(0, R.ROSTER_MAX - (Number(s.rosterTotal) || 0));
    for (const t of mine.slice(room)) { out.splice(out.indexOf(t), 1); skipped.push({ sideId: s.id, currency: t.currency, reason: 'rosterFull' }); }
  }
  return { transfers: out, skipped };
}

class ApkTransferService {
  constructor({ store, activity, sessions, friendNet = null, accountProfile = null, onChanged, createSocket, now = () => Date.now(), timing = {} }) {
    Object.assign(this, { store, activity, sessions, friendNet, accountProfile, createSocket, now });
    this.onChanged = onChanged || (() => {});
    this.timing = { gapMs: 2500, ...timing };
    this.controller = null;
    this.run = null;
  }

  // "Hesapla" (user 2026-11-20): every chosen account at once, without signing in: APK
  // (autoPKTickets) and TIX (ticket) of getUserBasicInfo, and the SOLD listings not claimed yet
  // (their payout joins the balance when the transfer claims them first).
  async scanBalances(accountIds) {
    const userOf = id => this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null;
    const ids = [...new Set(accountIds || [])].filter(id => userOf(id));
    const out = {};
    await eachWithSocket(ids, () => GameSocket.open({ createSocket: this.createSocket }), async (gs, id) => {
      const userId = userOf(id);
      const info = await gs.call('getUserBasicInfo', { userId }, 'userBasicInfo', { timeoutMs: 12000 });
      const sold = { APK: [], TIX: [] };
      const seen = new Set();
      let size = 1, read = 0;
      for (let page = 1; page <= 40; page++) {
        const d = await gs.call('market:getMyPlayerListings', { userId, page, search: '', basePlayersOnly: false }, 'market:myPlayerListingsData', { timeoutMs: 12000 });
        const tickets = (d?.tickets || []).filter(t => t?.id && !seen.has(t.id) && seen.add(t.id));
        for (const t of tickets) if (t.status === 'SOLD') sold[t.paymentMode === 'TICKET' ? 'TIX' : 'APK'].push(Number(t.price) || 0);
        if (page === 1) size = pageSizeOf(d);
        read += (d?.tickets || []).length;
        if (isLastPage(d, page, size, read)) break;
      }
      out[id] = { apk: Number(info?.autoPKTickets) || 0, tix: Number(info?.ticket) || 0, sold, at: new Date(this.now()).toISOString() };
    }, { onError: (id, e) => { out[id] = { error: e.message }; } });
    return out;
  }

  snapshot() {
    const s = this.store.getSettings?.() || {};
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, config: s.apkTransfer || null, lastReport: s.apkTransferReport || null };
  }
  stop() { this.controller?.abort(); }
  _account(id) { return this.store.getAccounts().find(a => a.id === id) || null; }
  _name(id) { return this._account(id)?.name || id; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'APK Transfer', code: `apk.${code}`, params, message });
  }
  _row(id, patch) { Object.assign(this.run.accounts[id], patch); this.onChanged(); }
  _step(step, params = {}) { this.run.step = step; this.run.stepParams = params; this.onChanged(); }
  _roleMap() { return R.roleMapFrom(this.store.getCardMetadata?.() || {}); }

  saveConfig(raw) {
    const config = normalizeConfig(raw);
    const settings = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...settings, apkTransfer: config });
    this.onChanged();
    return config;
  }

  validate(raw) {
    const c = normalizeConfig(raw);
    const ids = new Set(this.store.getAccounts().map(a => a.id));
    if (!c.mainId || !ids.has(c.mainId)) throw new Error('Choose the account that receives the APK / TIX.');
    if (!c.sideIds.filter(id => ids.has(id)).length) throw new Error('Choose at least one account to transfer from.');
    return c;
  }

  async runAndWait(raw, { signal } = {}) {
    if (this.controller) throw new Error('APK transfer is already running.');
    const config = this.validate(raw);
    this.saveConfig(config);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.controller = controller;
    const accounts = {};
    for (const id of [config.mainId, ...config.sideIds]) {
      accounts[id] = { accountId: id, name: this._name(id), main: id === config.mainId, status: 'queued', note: null,
        before: null, after: null, claimed: { count: 0, APK: 0, TIX: 0, feeAPK: 0, feeTIX: 0 }, eligible: [], skipped: [] };
    }
    this.run = { startedAt: new Date(this.now()).toISOString(), config, accounts, sales: [], transfers: [], step: 'starting', stepParams: {}, result: null, totals: null };
    this._log(null, 'info', 'start', { main: this._name(config.mainId), sides: config.sideIds.length, mode: config.mode }, `APK transfer started · to ${this._name(config.mainId)} · ${config.sideIds.length} account(s) · ${config.mode}`);
    this.onChanged();
    const conns = new Map();
    let result = null;
    try {
      result = await this._go(config, conns, controller.signal);
    } catch (error) {
      result = error?.name === 'AbortError' ? { reason: 'stopped' } : { reason: 'error', error: error.message };
      if (result.reason === 'error') this._log(null, 'error', 'failed', { error: error.message }, `APK transfer stopped: ${error.message}`);
    } finally {
      // the balances at the end (also after a stop or an error)
      await this._readBalances([...conns.keys()], conns, null, 'after').catch(() => {});
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

  // ---------- connections, balances, listings ----------
  async _conn(conns, id, signal) {
    if (conns.has(id)) return conns.get(id);
    if (this.run.accounts[id]) this._row(id, { status: 'login' });
    const c = await TradeGameAccount.open({ account: this._account(id), sessions: this.sessions, createSocket: this.createSocket, signal });
    conns.set(id, c);
    if (this.run.accounts[id]) this._row(id, { status: 'ready' });
    return c;
  }
  // Every balance read also goes to the account profile, so the whole app shows it at once
  // (user 2026-11-07: the APK of the accounts did not change in the app after a transfer).
  async _balance(c) {
    const info = await c.conn.call('getUserBasicInfo', { userId: c.userId }, 'userBasicInfo', { signal: c.signal, timeoutMs: 20000 });
    const b = { tk: Number(info?.funds), apk: Number(info?.autoPKTickets), tix: Number(info?.ticket) };
    const clean = Object.fromEntries(Object.entries(b).filter(([, v]) => Number.isFinite(v)));
    if (c.account?.id && Object.keys(clean).length) { try { this.accountProfile?.merge?.(c.account.id, clean); } catch {} }
    return b;
  }
  async _readBalances(ids, conns, signal, field) {
    await this._each(ids, async id => {
      const c = conns.get(id);
      if (!c) return;
      const b = await this._balance(c).catch(() => null);
      if (b && this.run.accounts[id]) this._row(id, { [field]: b });
    });
  }
  async _listings(c) {
    const page = n => c.conn.call('market:getMyPlayerListings', { userId: c.userId, page: n, search: '', basePlayersOnly: false }, 'market:myPlayerListingsData', { signal: c.signal, timeoutMs: 20000 });
    const first = await page(1);
    const pages = pageCount(first);
    const tickets = [...(first?.tickets || [])];
    for (let n = 2; n <= pages; n++) tickets.push(...((await page(n))?.tickets || []));
    const seen = new Set();
    return tickets.filter(t => t?.id && !seen.has(t.id) && seen.add(t.id));
  }
  // Market write with the game's "please wait" handling.
  async _write(c, event, payload, reply) {
    for (let attempt = 0; ; attempt++) {
      const r = await c.conn.call(event, payload, reply, { signal: c.signal, timeoutMs: 20000 });
      const raw = Number(r?.retryAfter ?? String(r?.message || '').match(/wait (\d+)/i)?.[1]);
      if (r?.success || !Number.isFinite(raw) || attempt >= 5) return r;
      await sleep((raw > 100 ? raw : raw * 1000) + 300, c.signal);
    }
  }
  async _each(ids, fn) {
    for (let i = 0; i < ids.length; i += CONCURRENCY) await Promise.all(ids.slice(i, i + CONCURRENCY).map(fn));
  }

  // Claims every SOLD listing of an account; returns what came in.
  async _claim(id, c, { only = null } = {}) {
    const acc = this.run.accounts[id];
    const tickets = (await this._listings(c)).filter(t => t.status === 'SOLD' && (!only || only.has(t.id)));
    const out = [];
    for (const t of tickets) {
      const r = await this._write(c, 'market:settleTicket', { ticketId: t.id }, 'market:settleResult').catch(error => ({ success: false, message: error.message }));
      const row = { ...listingRow(t, id), accountName: this._name(id) };
      if (r?.success) {
        const cur = row.currency;
        const payout = Number(r.payout) || 0;
        const fee = Number.isFinite(Number(r.fee)) ? Number(r.fee) : Math.max(0, row.price - payout);
        Object.assign(row, { payout, fee, claimed: true });
        if (acc && (cur === 'APK' || cur === 'TIX')) { acc.claimed.count++; acc.claimed[cur] += payout; acc.claimed[`fee${cur}`] += fee; }
      } else {
        Object.assign(row, { claimed: false, error: String(r?.message || 'refused') });
        this._log(id, 'warning', 'claimFailed', { name: row.name, error: row.error }, `${row.name}: the sale could not be claimed · ${row.error}`);
      }
      out.push(row);
    }
    this.onChanged();
    return out;
  }

  // ---------- the run ----------
  async _go(config, conns, signal) {
    const all = [config.mainId, ...config.sideIds];
    // 1. sign in, claim the sales, read the balances
    this._step('claiming', { n: all.length });
    await this._each(all, async id => {
      try {
        const c = await this._conn(conns, id, signal);
        this._row(id, { status: 'claiming' });
        const rows = await this._claim(id, c);
        this.run.sales.push(...rows);
        const bal = await this._balance(c);
        const roster = R.rosterOf(await c.roster());
        this._row(id, { status: 'ready', before: bal, rosterTotal: roster.total });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        this._row(id, { status: 'error', note: error.message });
        this._log(id, 'warning', 'loginFailed', { error: error.message }, `Could not be read: ${error.message}`);
      }
    });
    if (signal.aborted) throw abortError();
    const main = conns.get(config.mainId);
    if (!main) throw new Error(`${this._name(config.mainId)} could not be signed in.`);
    // 2. eligible sides and their transfers
    const sides = config.sideIds.filter(id => this.run.accounts[id].before).map(id => ({ id, ...this.run.accounts[id].before, rosterTotal: this.run.accounts[id].rosterTotal }));
    const { transfers, skipped } = planTransfers(sides, config);
    for (const s of skipped) this.run.accounts[s.sideId].skipped.push(s);
    for (const t of transfers) this.run.accounts[t.sideId].eligible.push(t.currency);
    this.run.transfers = transfers.map(t => ({ ...t, sideName: this._name(t.sideId), status: 'planned', player: null, playerId: null, source: null, ticketId: null, payout: null, fee: null, error: null }));
    for (const id of config.sideIds) if (!this.run.accounts[id].eligible.length && this.run.accounts[id].status !== 'error') this._row(id, { status: 'notEligible' });
    const eligibleSides = new Set(transfers.map(t => t.sideId));
    this._log(null, 'info', 'plan', { eligible: eligibleSides.size, total: config.sideIds.length, transfers: transfers.length }, `${eligibleSides.size} of ${config.sideIds.length} account(s) eligible · ${transfers.length} transfer(s)`);
    if (!transfers.length) return { reason: 'nothingEligible' };
    // 3. a cheap player of main listed for each transfer
    const finder = this._finder(config, conns, main, signal);
    for (const t of this.run.transfers) {
      if (signal.aborted) throw abortError();
      this._step('finding', { side: t.sideName, currency: t.currency, n: this.run.transfers.indexOf(t) + 1, of: this.run.transfers.length });
      const p = await finder.next();
      if (!p) { t.status = 'noPlayer'; t.error = 'No cheap player could be found.'; continue; }
      Object.assign(t, { player: p.name, playerId: p.id, source: p.source, salary: p.salary, status: 'listing' });
      this.onChanged();
      const r = await main.sell(p.id, t.price, t.currency).catch(error => ({ success: false, message: error.message }));
      if (!r?.success) { Object.assign(t, { status: 'listFailed', error: String(r?.message || 'refused') }); this._log(config.mainId, 'warning', 'listFailed', { name: p.name, price: t.price, currency: t.currency, error: t.error }, `${p.name} could not be listed at ${t.price} ${t.currency}: ${t.error}`); continue; }
      const ticket = (await this._listings(main)).find(x => (x.playerId || x.player?.id) === p.id && x.status === 'LISTED' && Number(x.price) === t.price && x.paymentMode === CURRENCIES[t.currency].mode);
      Object.assign(t, { ticketId: ticket?.id || null, status: ticket ? 'listed' : 'listFailed', error: ticket ? null : 'The listing was not found after listing.' });
      this.onChanged();
      await sleep(this.timing.gapMs, signal);
    }
    // 4. every side buys its own listing, all at the same time
    const ready = this.run.transfers.filter(t => t.status === 'listed');
    if (!ready.length) return { reason: 'noPlayers' };
    this._step('buying', { n: ready.length });
    const bySide = new Map();
    for (const t of ready) { if (!bySide.has(t.sideId)) bySide.set(t.sideId, []); bySide.get(t.sideId).push(t); }
    await Promise.all([...bySide.entries()].map(async ([sideId, list]) => {
      const c = conns.get(sideId);
      this._row(sideId, { status: 'buying' });
      for (const t of list) {
        // the seller check: the listing must still be main's, the planned player, at the planned price
        const ok = (await this._listings(main).catch(() => [])).find(x => x.id === t.ticketId && x.status === 'LISTED' && (x.playerId || x.player?.id) === t.playerId && Number(x.price) === t.price);
        if (!ok) { Object.assign(t, { status: 'buyFailed', error: 'The listing is no longer there.' }); continue; }
        t.status = 'buying'; this.onChanged();
        const r = await this._write(c, 'market:buyPlayer', { userId: c.userId, ticketId: t.ticketId }, 'market:buyResult').catch(error => ({ success: false, message: error.message }));
        Object.assign(t, r?.success ? { status: 'bought', error: null } : { status: 'buyFailed', error: String(r?.message || r?.error || 'refused') });
        if (!r?.success) this._log(sideId, 'warning', 'buyFailed', { name: t.player, price: t.price, currency: t.currency, error: t.error }, `${t.player} could not be bought (${t.price} ${t.currency}): ${t.error}`);
        this.onChanged();
        if (list.length > 1) await sleep(this.timing.gapMs, signal);
      }
      this._row(sideId, { status: 'done' });
    }));
    // 5. main claims the sales
    this._step('mainClaim');
    const mine = new Set(this.run.transfers.filter(t => t.status === 'bought').map(t => t.ticketId));
    const claimed = await this._claim(config.mainId, main, { only: mine });
    for (const row of claimed) {
      const t = this.run.transfers.find(x => x.ticketId === row.ticketId);
      if (t) Object.assign(t, row.claimed ? { status: 'claimed', payout: row.payout, fee: row.fee } : { status: 'claimFailed', error: row.error });
    }
    // a listing nobody bought is taken off the market again (the player comes back to main)
    for (const t of this.run.transfers.filter(x => x.status === 'buyFailed' && x.ticketId)) {
      await this._write(main, 'market:cancelPlayerListing', { userId: main.userId, ticketId: t.ticketId }, 'market:cancelResult').catch(() => null);
    }
    this._row(config.mainId, { status: 'done' });
    const failed = this.run.transfers.filter(t => t.status !== 'claimed').length;
    return { reason: failed ? 'partial' : 'done' };
  }

  // Cheap players for main, one at a time: main's Scout → main's friends' Scouts → spenders.
  _finder(config, conns, main, signal) {
    const roleMap = this._roleMap();
    const used = new Set();
    const pool = [];
    let owned = null;
    const fits = a => a && !a.isSigned && Number(a.baseSalary) <= config.maxTk && !(roleMap.get(a.id) || []).length && !used.has(a.id) && !owned?.has(a.id);
    const refreshOwned = async () => { owned = R.rosterOf(await main.roster()).ids; };
    const take = (p, source) => { used.add(p.id); return { id: p.id, name: p.visualName || p.name, salary: Number(p.signedSalary || p.baseSalary) || null, source }; };
    let scoutDone = false, friendsDone = false, spendersDone = !config.useSpenders || !this.friendNet;
    let owners = null;
    // a friend's Scout board is the same whoever reads it: one with nothing cheap on it is not
    // read again in this run (2026-11-08: 60 spenders read the same empty boards for minutes)
    const emptyOwners = new Set();
    const where = name => this._step('scanning', { where: name });
    const readBoards = async (viewerId, us) => {
      const out = [];
      for (let i = 0; i < us.length; i += 50) {
        if (signal.aborted) throw abortError();
        const part = us.slice(i, i + 50);
        const boards = await Promise.all(part.map(u => this.friendNet.board(viewerId, u, signal).catch(() => null)));
        part.forEach((u, k) => { if (!(boards[k]?.freeAgents || []).some(fits)) emptyOwners.add(u); else out.push([u, boards[k]]); });
      }
      return out;
    };
    const spenderQueue = this.store.getAccounts().filter(a => a.role === 'spender' && a.id !== config.mainId && !config.sideIds.includes(a.id)).map(a => a.id);
    const fromScout = async () => {
      const fa = await main.freeAgents().catch(() => null);
      const cand = (fa?.freeAgents || []).find(fits);
      if (!cand) { scoutDone = true; return null; }
      const r = await main.sign(cand.id).catch(() => null);
      used.add(cand.id);
      if (!r?.success) return null;
      return take(cand, 'scout');
    };
    const fromFriends = async () => {
      if (!this.friendNet) { friendsDone = true; return null; }
      if (!owners) {
        const f = await this.friendNet.friendsOf(config.mainId, { signal }).catch(() => null);
        owners = f ? [...f.ids].map(u => ({ u, name: f.names.get(u) })) : [];
      }
      while (owners.length) {
        const o = owners[0];
        if (emptyOwners.has(o.u)) { owners.shift(); continue; }
        where(o.name || '?');
        const board = await this.friendNet.board(config.mainId, o.u, signal).catch(() => null);
        if (!(board?.freeAgents || []).some(fits)) emptyOwners.add(o.u);
        const cand = (board?.freeAgents || []).find(fits);
        if (!cand) { owners.shift(); continue; }
        const r = await this.friendNet.signFrom(config.mainId, o.u, cand.id, signal).catch(() => null);
        used.add(cand.id);
        if (r?.success) return take(cand, `friend:${o.name || '?'}`);
        if (/limit|daily|today|maximum|too many/i.test(String(r?.message || r?.error || ''))) { owners.length = 0; break; }
      }
      friendsDone = true;
      return null;
    };
    // a spender signs a batch (its Scout, then its friends' Scouts) and trades it to main as
    // main has room; what main has no room for yet waits on the spender for the next trade
    const waiting = []; // { sp, players }
    const tradeWaiting = async () => {
      const w = waiting[0];
      const mainRoster = R.rosterOf(await main.roster());
      const fit = w.players.slice(0, Math.max(0, R.ROSTER_MAX - mainRoster.total));
      if (!fit.length) return null;
      this._step('trading', { spender: this._name(w.sp), n: fit.length });
      const traded = await this._trade(main, conns.get(w.sp), fit, signal);
      if (!traded.success) { this._log(w.sp, 'warning', 'tradeFailed', { error: traded.message }, `Trade to ${this._name(config.mainId)} failed: ${traded.message}`); waiting.shift(); return null; }
      w.players = w.players.slice(fit.length);
      if (!w.players.length) waiting.shift();
      pool.push(...fit);
      return pool.shift();
    };
    const fromSpender = async () => {
      while (waiting.length) { const p = await tradeWaiting(); if (p) return p; if (waiting.length && !pool.length) break; }
      while (spenderQueue.length) {
        const sp = spenderQueue[0];
        where(this._name(sp));
        const need = Math.max(1, Math.min(TRADE_BATCH, this.run.transfers.filter(t => t.status === 'planned').length - pool.length));
        let c;
        try { c = await this._conn(conns, sp, signal); } catch (error) { if (error?.name === 'AbortError') throw error; spenderQueue.shift(); continue; }
        const spRoster = R.rosterOf(await c.roster());
        const room = Math.min(need, R.ROSTER_MAX - spRoster.total);
        const tk = await c.funds().catch(() => NaN);
        const got = [];
        const spFits = a => fits(a) && !spRoster.ids.has(a.id);
        if (room > 0) {
          const fa = await c.freeAgents().catch(() => null);
          for (const a of (fa?.freeAgents || []).filter(spFits)) {
            if (got.length >= room || (Number.isFinite(tk) && tk < Number(a.baseSalary) * (got.length + 1))) break;
            const r = await c.sign(a.id).catch(() => null);
            used.add(a.id);
            if (r?.success) got.push(take(a, `spender:${this._name(sp)}`));
          }
          if (got.length < room && this.friendNet) {
            const f = await this.friendNet.friendsOf(sp, { signal }).catch(() => null);
            const us = (f ? [...f.ids] : []).filter(u => !emptyOwners.has(u));
            for (const [u, board] of await readBoards(sp, us)) {
              if (got.length >= room) break;
              for (const a of (board?.freeAgents || []).filter(spFits)) {
                if (got.length >= room) break;
                const r = await this.friendNet.signFrom(sp, u, a.id, signal).catch(() => null);
                used.add(a.id);
                if (r?.success) got.push(take(a, `spender:${this._name(sp)}`));
              }
            }
          }
        }
        // a spender that filled its batch may have more: it stays first in line
        if (got.length < room || room <= 0) spenderQueue.shift();
        if (!got.length) continue;
        waiting.push({ sp, players: got });
        const p = await tradeWaiting();
        if (p) return p;
      }
      spendersDone = true;
      return null;
    };
    return {
      next: async () => {
        if (pool.length) return pool.shift();
        if (!owned) await refreshOwned();
        const mainRoster = R.rosterOf(await main.roster());
        if (mainRoster.total >= R.ROSTER_MAX) throw new Error(`The roster of ${this._name(config.mainId)} is full: it needs one free place.`);
        while (!scoutDone) { const p = await fromScout(); if (p) return p; }
        while (!friendsDone) { const p = await fromFriends(); if (p) return p; }
        while (!spendersDone) { const p = await fromSpender(); if (p) return p; }
        return null;
      }
    };
  }

  // The spender hosts, main joins; the spender gives `players`, main gives nothing (pays their salary in TK).
  async _trade(main, spender, players, signal) {
    const password = String(crypto.randomInt(10000000, 99999999));
    let roomId = null;
    try {
      roomId = await spender.createRoom('APK', password);
      const joined = spender.expect('joinedRoomData', d => d?.roomId === roomId);
      const room = await main.joinRoom(roomId, password);
      await joined.catch(() => null);
      const sel = players.map(p => (room.hostPlayers || []).find(x => x.id === p.id));
      if (sel.some(x => !x)) return { success: false, message: 'A player is not offered in the trade room.' };
      const upd = main.expect('tradeSelectionUpdate', d => d?.roomId === roomId && sameIds(d.hostSelectedPlayers, sel));
      spender.select(roomId, sel);
      await upd;
      await sleep(300, signal);
      for (let attempt = 1; ; attempt++) {
        const both = main.expect('acceptTradeUpdate', d => d?.hostAccepted && d?.guestAccepted, ACCEPT_WAIT_MS);
        spender.accept(roomId);
        await sleep(250, signal);
        main.accept(roomId);
        try { await both; break; } catch (error) { if (attempt >= ACCEPT_TRIES) throw error; }
      }
      const resultP = main.expect('tradeResult', () => true);
      main.confirm(roomId, sel, []);
      const result = await resultP;
      return { success: Boolean(result?.success), message: result?.message || '' };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return { success: false, message: error.message };
    } finally {
      if (roomId) spender.cancelRoom(roomId);
      main.leave();
    }
  }

  _report(result) {
    const r = this.run;
    const sum = (list, k) => list.reduce((n, x) => n + (Number(x[k]) || 0), 0);
    const totals = {};
    for (const cur of ['APK', 'TIX']) {
      const done = r.transfers.filter(t => t.currency === cur && t.status === 'claimed');
      totals[cur] = { sent: sum(done, 'price'), received: sum(done, 'payout'), fee: sum(done, 'fee'), count: done.length,
        preClaimed: Object.values(r.accounts).reduce((n, a) => n + (a.claimed[cur] || 0), 0) - sum(done, 'payout'),
        preFee: Object.values(r.accounts).reduce((n, a) => n + (a.claimed[`fee${cur}`] || 0), 0) - sum(done, 'fee') };
    }
    r.totals = totals;
    const report = { ...JSON.parse(JSON.stringify(r)), finishedAt: new Date(this.now()).toISOString(), reason: result?.reason || 'error', error: result?.error || null };
    const settings = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...settings, apkTransferReport: report });
    const params = { apk: totals.APK.received, tix: totals.TIX.received, feeApk: totals.APK.fee, feeTix: totals.TIX.fee, n: totals.APK.count + totals.TIX.count, of: r.transfers.length };
    const line = `${params.n}/${params.of} transfer(s) · main got ${params.apk} APK (fee ${params.feeApk}) · ${params.tix} TIX (fee ${params.feeTix})`;
    const lines = {
      done: ['success', 'done', `APK transfer finished · ${line}`],
      partial: ['warning', 'partial', `APK transfer finished with gaps · ${line}`],
      nothingEligible: ['warning', 'nothingEligible', 'APK transfer: no account has the minimum balance'],
      noPlayers: ['warning', 'noPlayers', `APK transfer: no cheap player could be found or listed · ${line}`],
      stopped: ['info', 'stopped', `APK transfer stopped · ${line}`],
      error: ['error', 'summaryError', `APK transfer stopped with an error · ${line}`]
    }[report.reason] || ['info', 'stopped', line];
    this._log(null, lines[0], lines[1], params, lines[2]);
  }
}

// The market keeps max(3, 5 % rounded up) of a sale (every fee of the past transfers fits).
const marketFee = price => Math.max(3, Math.ceil(Number(price) * 0.05));

module.exports = { ApkTransferService, normalizeConfig, planTransfers, marketFee };
