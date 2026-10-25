const { GameSocket } = require('./game-socket.cjs');

// Market (City -> Market building) without a browser: everything below is the
// game's own /socket/ traffic, captured from the page.
//   market:getMyPlayerListings {userId, page, search:'', basePlayersOnly:false}
//                                  -> market:myPlayerListingsData {tickets[8], total}
//   market:settleTicket {ticketId}  -> market:settleResult {success, paymentMode, payout, fee}   (Claim)
//   market:cancelPlayerListing {userId, ticketId} -> cancelResult {success, playerId | message} (Remove)
//   market:sellPlayer {userId, playerId, price, paymentMode} -> market:sellResult {success | message}
//   getUserBasicInfo {userId}      -> userBasicInfo {autoPKTickets (APK), ticket (TIX), funds (TK), level}
// Every write may answer "Please wait N seconds…" with `retryAfter`; the call
// is repeated after that wait. Removing a listing fails with "You already own
// this player." while the same player is already in the roster.
const PAGE_SIZE = 8;
const ACCOUNT_CONCURRENCY = 4;
const MAX_ATTEMPTS = 5;
const CURRENCY = { APK_TICKET: 'APK', TICKET: 'TIX' };
const PAYMENT_MODE = { APK: 'APK_TICKET', TIX: 'TICKET' };

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function listingRow(ticket, accountId) {
  const player = ticket?.player || {};
  const salary = Number(ticket?.signedSalary);
  const base = Number(player.newBaseSalary);
  const hasBase = Number.isFinite(base) && base > 0;
  return {
    ticketId: ticket.id,
    playerId: ticket.playerId || player.id || null,
    accountId,
    name: String(player.visualName || player.name || '').trim(),
    grade: player.rating ? String(player.rating).toUpperCase() : null,
    position: player.position || null,
    salary: Number.isFinite(salary) ? salary : null,
    base: hasBase ? base : null,
    basePct: hasBase && Number.isFinite(salary) ? Math.round(((salary - base) / base) * 1000) / 10 : null,
    price: Number(ticket.price),
    currency: CURRENCY[ticket.paymentMode] || ticket.paymentMode || null,
    status: ticket.status || null,
    createdAt: ticket.createdAt || null
  };
}

const countBy = (rows, status) => rows.filter(row => row.status === status).length;

// Listings expire every day at 19:10 Turkey time (UTC+3, no DST) = 16:10 UTC.
const DAY_MS = 24 * 60 * 60 * 1000;
// "onSale" = still listed; "recent" = expired at the last 19:10 (it was on
// sale yesterday); "stock" = expired earlier and left as stock.
function listingKind(row, now = Date.now()) {
  if (row.status === 'LISTED') return 'onSale';
  if (row.status !== 'EXPIRED') return null;
  const created = Date.parse(row.createdAt);
  const cutoff = lastExpiryCutoff(now);
  return Number.isFinite(created) && created >= cutoff - DAY_MS ? 'recent' : 'stock';
}

function lastExpiryCutoff(now = Date.now()) {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 10);
  return today <= now ? today : today - DAY_MS;
}

class MarketService {
  constructor({ store, activity, accountProfile = null, sessions, onChanged, createSocket, concurrency = ACCOUNT_CONCURRENCY, minRetryMs = 0, writeTimeoutMs = 15000 }) {
    this.store = store;
    this.activity = activity;
    this.accountProfile = accountProfile;
    this.sessions = sessions;
    this.onChanged = onChanged;
    this.createSocket = createSocket;
    this.concurrency = concurrency;
    this.minRetryMs = minRetryMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.accounts = new Map(); // accountId -> per-account state
    // rows: LISTED + EXPIRED listings of every scanned account (ticketId ->
    // row + relist state); lastRun: result per ticket of the latest relist.
    this.relist = { status: 'idle', rows: {}, lastRun: {}, report: null, startedAt: null, finishedAt: null };
    this.job = null;
  }

  // ---------- state ----------
  account(accountId) {
    const found = this.store.getAccounts().find(a => a.id === accountId);
    if (!found) throw new Error('Account not found.');
    return found;
  }

  state(accountId) {
    if (!this.accounts.has(accountId)) {
      this.accounts.set(accountId, { status: 'idle', step: null, stepParams: {}, rows: [], counts: null, scannedAt: null, lastClaim: null, error: null });
    }
    return this.accounts.get(accountId);
  }

  set(accountId, patch) {
    Object.assign(this.state(accountId), patch);
    this.onChanged?.();
  }

  snapshot() {
    const accounts = {};
    for (const [id, s] of this.accounts) {
      accounts[id] = { ...s, sold: s.rows.filter(row => row.status === 'SOLD') };
      delete accounts[id].rows;
    }
    return { busy: Boolean(this.job), jobKind: this.job?.kind || null, accounts, relist: this.relist };
  }

  log(account, level, message, code = null, params = null) {
    this.activity.add({ level, accountId: account?.id || 'market', accountName: account?.name || '', taskName: 'Market', message, code, params });
  }

  // ---------- plumbing ----------
  // `concurrency`: how many accounts work at the same time (the relist setting).
  async _runJob(kind, accountIds, perAccount, { onDone, concurrency = null } = {}) {
    if (this.job) throw new Error('Another Market operation is running. Wait for it or press Stop.');
    const accounts = this.store.getAccounts().filter(a => accountIds.includes(a.id));
    if (!accounts.length) throw new Error('Select at least one account.');
    const controller = new AbortController();
    this.job = { kind, controller };
    this.onChanged?.();
    const results = new Map();
    try {
      let next = 0;
      const limit = Math.max(1, Math.floor(Number(concurrency)) || this.concurrency);
      await Promise.all(Array.from({ length: Math.min(limit, accounts.length) }, async () => {
        while (next < accounts.length) {
          const account = accounts[next++];
          if (controller.signal.aborted) return;
          const socket = { current: null };
          try {
            results.set(account.id, await perAccount(account, controller.signal, socket));
          } catch (error) {
            const stopped = error?.name === 'AbortError';
            this.set(account.id, { status: stopped ? 'stopped' : 'error', step: stopped ? 'stopped' : 'error', stepParams: { error: error.message }, error: stopped ? null : error.message });
            if (!stopped) this.log(account, 'error', `Market: ${error.message}`, 'mk.failed', { error: error.message });
            results.set(account.id, { error: error.message, stopped });
          } finally {
            socket.current?.close();
          }
        }
      }));
      await onDone?.(results, controller.signal);
      return results;
    } finally {
      this.job = null;
      this.onChanged?.();
    }
  }

  async _connect(account, signal, holder) {
    this.set(account.id, { status: 'working', step: 'login', stepParams: {}, error: null });
    const session = await this.sessions.get(account, { owner: 'market', log: (level, message) => this.log(account, level, message) });
    if (signal.aborted) throw abortError();
    const open = async () => {
      holder.current = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
      // Market writes need the socket registered as the user (see GameSocket.register).
      await holder.current.register(session.userId, { signal });
      return holder.current;
    };
    const conn = { userId: session.userId, socket: await open() };
    // A sign-in of the same account elsewhere (e.g. Daily Reward's browser at 21:00)
    // kicks this socket and the game stops answering it: open a fresh one.
    conn.reconnect = async () => {
      try { holder.current?.close(); } catch {}
      conn.socket = await open();
      this.log(account, 'info', 'Market connection was taken over by another sign-in · reconnected.', 'mk.reconnected', {});
    };
    return conn;
  }

  // Writes answer "Please wait N seconds" with retryAfter: wait and repeat.
  // "Authentication required" means the registration was dropped (the same
  // account registered elsewhere): register again once and repeat.
  async _write(conn, event, payload, replyEvent, signal) {
    let reply = null;
    let reregistered = false;
    let reconnected = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        reply = await conn.socket.call(event, payload, replyEvent, { signal, timeoutMs: this.writeTimeoutMs });
      } catch (error) {
        // No reply: the socket was kicked or dropped. Reconnect once and repeat.
        if (reconnected || !conn.reconnect || error?.name === 'AbortError' || !/no reply|disconnect|closed/i.test(error?.message || '')) throw error;
        reconnected = true;
        await conn.reconnect();
        continue;
      }
      if (!reply?.success && !reregistered && /authentication required/i.test(reply?.message || '')) {
        reregistered = true;
        await conn.socket.register(conn.userId, { signal });
        continue;
      }
      const wait = Number(reply?.retryAfter);
      if (reply?.success || !Number.isFinite(wait)) return reply;
      await sleep(Math.max(this.minRetryMs, wait * 1000 + 250), signal);
    }
    return reply;
  }

  async _scanListings(account, { userId, socket }, signal) {
    this.set(account.id, { step: 'scanning', stepParams: { page: 1, pages: 1 } });
    const fetchPage = page => socket.call('market:getMyPlayerListings', { userId, page, search: '', basePlayersOnly: false }, 'market:myPlayerListingsData', { signal });
    const first = await fetchPage(1);
    const pages = Math.max(1, Math.ceil(Number(first?.total || 0) / PAGE_SIZE));
    const seen = new Set();
    const rows = [];
    const add = data => { for (const ticket of data?.tickets || []) if (!seen.has(ticket.id)) { seen.add(ticket.id); rows.push(listingRow(ticket, account.id)); } };
    add(first);
    for (let page = 2; page <= pages; page++) {
      this.set(account.id, { stepParams: { page, pages } });
      add(await fetchPage(page));
    }
    const counts = { listed: countBy(rows, 'LISTED'), sold: countBy(rows, 'SOLD'), expired: countBy(rows, 'EXPIRED'), total: rows.length };
    this._syncRelistRows(account.id, rows);
    this.set(account.id, { rows, counts, scannedAt: new Date().toISOString() });
    return rows;
  }

  async _refreshBalance(account, { userId, socket }, signal) {
    const info = await socket.call('getUserBasicInfo', { userId }, 'userBasicInfo', { signal }).catch(() => null);
    if (!info?.success) return null;
    const balance = { apk: Number(info.autoPKTickets), tix: Number(info.ticket), tk: Number(info.funds), level: Number(info.level), expCurrent: Number(info.experience), expMax: Number(info.nextLvl) };
    if (balance.expMax > 0) balance.expPercent = Math.floor((balance.expCurrent / balance.expMax) * 100);
    const clean = Object.fromEntries(Object.entries(balance).filter(([, v]) => Number.isFinite(v)));
    this.accountProfile?.merge?.(account.id, clean);
    return clean;
  }

  // ---------- Sales: scan + claim ----------
  async scan(accountIds) {
    return this._runJob('scan', accountIds, async (account, signal, holder) => {
      const conn = await this._connect(account, signal, holder);
      const rows = await this._scanListings(account, conn, signal);
      const counts = this.state(account.id).counts;
      this.set(account.id, { status: 'done', step: 'scanned', stepParams: counts });
      this.log(account, 'success', `Market scanned · ${counts.listed} listed · ${counts.sold} sold · ${counts.expired} expired.`, 'mk.scanned', counts);
      return rows;
    }).then(() => this.snapshot());
  }

  async claim(accountIds) {
    return this._runJob('claim', accountIds, async (account, signal, holder) => {
      const conn = await this._connect(account, signal, holder);
      const rows = await this._scanListings(account, conn, signal);
      const sold = rows.filter(row => row.status === 'SOLD');
      const payout = { APK: 0, TIX: 0 };
      let claimed = 0;
      const failures = [];
      for (const row of sold) {
        this.set(account.id, { step: 'claiming', stepParams: { name: row.name, done: claimed, total: sold.length } });
        const reply = await this._write(conn, 'market:settleTicket', { ticketId: row.ticketId }, 'market:settleResult', signal);
        if (reply?.success) {
          claimed++;
          const currency = CURRENCY[reply.paymentMode] || row.currency;
          payout[currency] = (payout[currency] || 0) + Number(reply.payout || 0);
          this.log(account, 'success', `Sale claimed · ${row.name} · +${reply.payout} ${currency} (fee ${reply.fee ?? 0}).`, 'mk.claimed', { name: row.name, payout: reply.payout, currency, fee: reply.fee ?? 0 });
        } else {
          failures.push({ name: row.name, message: reply?.message || 'unknown reply' });
          this.log(account, 'warning', `Sale could not be claimed · ${row.name} · ${reply?.message || 'unknown reply'}.`, 'mk.claimFailed', { name: row.name, message: reply?.message || '—' });
        }
      }
      const balance = await this._refreshBalance(account, conn, signal);
      await this._scanListings(account, conn, signal);
      this.set(account.id, { status: 'done', step: 'claimed', stepParams: { claimed, apk: payout.APK, tix: payout.TIX }, lastClaim: { at: new Date().toISOString(), claimed, payout, failures, balance } });
      if (sold.length || claimed) {
        this.log(account, failures.length ? 'warning' : 'success',
          `Claim finished · ${claimed}/${sold.length} sale(s) · +${payout.APK} APK · +${payout.TIX} TIX${balance ? ` · balance APK ${balance.apk} · TIX ${balance.tix}` : ''}.`,
          'mk.claimDone', { claimed, total: sold.length, apk: payout.APK, tix: payout.TIX, balanceApk: balance?.apk ?? '—', balanceTix: balance?.tix ?? '—' });
      } else {
        this.log(account, 'info', 'No sold listings to claim.', 'mk.nothingToClaim');
      }
      return { claimed, payout, failures };
    }).then(() => this.snapshot());
  }

  // ---------- Relist: remove + list again (LISTED or EXPIRED) ----------
  // A removed-but-not-listed player stays visible even though its ticket is
  // gone, so it is never missed; other results reset on the next scan.
  _syncRelistRows(accountId, rows) {
    const next = {};
    for (const [id, row] of Object.entries(this.relist.rows)) {
      if (row.accountId !== accountId || row.state === 'removedNotListed') next[id] = row;
    }
    for (const row of rows) {
      if (row.status !== 'LISTED' && row.status !== 'EXPIRED') continue;
      const prev = this.relist.rows[row.ticketId];
      const keep = prev && ['owned', 'failed'].includes(prev.state);
      next[row.ticketId] = { ...row, kind: listingKind(row), state: keep ? prev.state : 'ready', message: keep ? prev.message : null };
    }
    this.relist.rows = next;
  }

  async loadRelist(accountIds) {
    this.relist.status = 'loading';
    this.relist.startedAt = new Date().toISOString();
    this.onChanged?.();
    await this._runJob('relist-load', accountIds, async (account, signal, holder) => {
      const conn = await this._connect(account, signal, holder);
      const rows = await this._scanListings(account, conn, signal);
      const expired = rows.filter(row => row.status === 'EXPIRED');
      this.set(account.id, { status: 'done', step: 'expiredFound', stepParams: { count: expired.length } });
      this.log(account, 'info', `${expired.length} expired player(s) ready to relist.`, 'mk.expiredFound', { count: expired.length });
    });
    this.relist.status = 'loaded';
    this.relist.finishedAt = new Date().toISOString();
    this.onChanged?.();
    return this.snapshot();
  }

  _setRelistRow(ticketId, patch) {
    const row = this.relist.rows[ticketId];
    if (!row) return;
    Object.assign(row, patch);
    if (patch.state) this.relist.lastRun[ticketId] = { name: row.name, accountId: row.accountId, state: row.state, message: row.message ?? null, price: row.newPrice, currency: row.newCurrency };
    this.onChanged?.();
  }

  // items: [{ ticketId, price, currency: 'APK'|'TIX' }] from the loaded rows.
  async relistPlayers(items = [], { concurrency = null } = {}) {
    const wanted = new Map();
    for (const item of items) {
      const row = this.relist.rows[item.ticketId];
      const price = Math.round(Number(item.price));
      const paymentMode = PAYMENT_MODE[item.currency];
      if (!row) continue;
      if (!Number.isFinite(price) || price < 1) throw new Error(`Invalid price for ${row.name}.`);
      if (!paymentMode) throw new Error(`Invalid currency for ${row.name}.`);
      wanted.set(row.ticketId, { row, price, paymentMode, currency: item.currency });
    }
    if (!wanted.size) throw new Error('Select at least one player.');
    const byAccount = new Map();
    for (const item of wanted.values()) {
      if (!byAccount.has(item.row.accountId)) byAccount.set(item.row.accountId, []);
      byAccount.get(item.row.accountId).push(item);
      this._setRelistRow(item.row.ticketId, { state: 'queued', message: null, newPrice: item.price, newCurrency: item.currency });
    }
    this.relist.status = 'running';
    this.relist.startedAt = new Date().toISOString();
    this.relist.report = null;
    this.relist.lastRun = {};
    for (const item of wanted.values()) this._setRelistRow(item.row.ticketId, { state: 'queued' });
    this.onChanged?.();

    await this._runJob('relist', [...byAccount.keys()], async (account, signal, holder) => {
      const conn = await this._connect(account, signal, holder);
      const list = byAccount.get(account.id);
      let done = 0;
      for (const item of list) {
        if (signal.aborted) throw abortError();
        this.set(account.id, { step: 'relisting', stepParams: { name: item.row.name, done, total: list.length } });
        await this._relistOne(account, conn, item, signal);
        done++;
      }
      // Show the new listings (and their prices) right away.
      if (!signal.aborted) await this._scanListings(account, conn, signal).catch(() => {});
      this.set(account.id, { status: 'done', step: 'relisted', stepParams: { done, total: list.length } });
    }, {
      concurrency,
      onDone: async results => {
        for (const [accountId, result] of results) {
          if (!result?.error) continue;
          for (const item of byAccount.get(accountId) || []) {
            const row = this.relist.rows[item.row.ticketId];
            if (row && ['queued', 'removing', 'listing'].includes(row.state)) {
              this._setRelistRow(item.row.ticketId, { state: row.state === 'listing' ? 'removedNotListed' : (result.stopped ? 'stopped' : 'failed'), message: result.stopped ? null : result.error });
            }
          }
        }
      }
    });
    this.relist.status = 'done';
    this.relist.finishedAt = new Date().toISOString();
    this.relist.report = this._relistReport([...wanted.keys()]);
    const r = this.relist.report;
    this.log(null, r.removedNotListed || r.failed ? 'warning' : 'success',
      `Relist finished · ${r.listed} listed · ${r.owned} already in roster · ${r.failed} failed · ${r.removedNotListed} removed but not listed.`,
      'mk.relistDone', r);
    this.onChanged?.();
    return this.snapshot();
  }

  // Stop is honoured between players only: once a listing is removed, the
  // player is always offered for sale again, never left half done.
  async _relistOne(account, conn, item, signal) {
    const { row, price, paymentMode, currency } = item;
    if (signal.aborted) throw abortError();
    this._setRelistRow(row.ticketId, { state: 'removing' });
    const removed = await this._write(conn, 'market:cancelPlayerListing', { userId: conn.userId, ticketId: row.ticketId }, 'cancelResult', null);
    if (!removed?.success) {
      const message = removed?.message || 'unknown reply';
      const owned = /already own/i.test(message);
      this._setRelistRow(row.ticketId, { state: owned ? 'owned' : 'failed', message });
      this.log(account, 'warning', `${row.name} could not be removed from the market · ${message}.`, owned ? 'mk.relistOwned' : 'mk.relistRemoveFailed', { name: row.name, message });
      return;
    }
    this._setRelistRow(row.ticketId, { state: 'listing' });
    const playerId = removed.playerId || row.playerId;
    const listed = await this._write(conn, 'market:sellPlayer', { userId: conn.userId, playerId, price, paymentMode }, 'market:sellResult', null);
    if (listed?.success) {
      this._setRelistRow(row.ticketId, { state: 'listed', message: null });
      this.log(account, 'success', `${row.name} listed again · ${price} ${currency}.`, 'mk.relisted', { name: row.name, price, currency });
    } else {
      const message = listed?.message || 'unknown reply';
      this._setRelistRow(row.ticketId, { state: 'removedNotListed', message });
      this.log(account, 'error', `${row.name} was removed but could not be listed again · ${message}. The player is back in the roster.`, 'mk.relistSellFailed', { name: row.name, message });
    }
  }

  // Scheduled relist: only listings that expired at the latest 19:10 cutoff,
  // i.e. created after the cutoff before it. Older expired listings are the
  // user's stock and stay untouched. Same price and currency as before.
  async relistRecent(accountIds, { now = Date.now(), signal = null } = {}) {
    const onAbort = () => this.stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.loadRelist(accountIds);
      if (signal?.aborted) throw abortError();
      const rows = Object.values(this.relist.rows).filter(row => row.status === 'EXPIRED' && accountIds.includes(row.accountId));
      const recent = rows.filter(row => listingKind(row, now) === 'recent');
      for (const accountId of new Set(rows.map(row => row.accountId))) {
        const account = this.store.getAccounts().find(a => a.id === accountId);
        const picked = recent.filter(row => row.accountId === accountId).length;
        const skipped = rows.filter(row => row.accountId === accountId).length - picked;
        this.log(account, 'info', `${picked} listing(s) from yesterday will be relisted · ${skipped} older expired kept as stock.`, 'mk.relistRecentPicked', { count: picked, skipped });
      }
      if (!recent.length) {
        this.log(null, 'info', 'No listings expired at the last 19:10 · nothing to relist.', 'mk.relistNothingRecent');
        return this.snapshot();
      }
      // Same "accounts at once" as the Market page (default: every account).
      const parallel = Number(this.store.getSettings?.()?.marketRelistParallel) || this.store.getAccounts().length;
      return await this.relistPlayers(recent.map(row => ({ ticketId: row.ticketId, price: row.price, currency: row.currency })), { concurrency: parallel });
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  _relistReport(ticketIds) {
    const rows = ticketIds.map(id => this.relist.lastRun[id]).filter(Boolean);
    const count = state => rows.filter(row => row.state === state).length;
    return { total: rows.length, listed: count('listed'), owned: count('owned'), failed: count('failed'), removedNotListed: count('removedNotListed'), stopped: count('stopped') };
  }

  clearRelist() {
    if (this.job?.kind?.startsWith('relist')) throw new Error('Relist is running.');
    this.relist = { ...this.relist, lastRun: {}, report: null };
    this.onChanged?.();
  }

  // ---------- lifecycle ----------
  async stop() {
    this.job?.controller.abort();
    return true;
  }

  async remove(accountId) {
    this.accounts.delete(accountId);
    for (const [id, row] of Object.entries(this.relist.rows)) if (row.accountId === accountId) delete this.relist.rows[id];
    this.onChanged?.();
  }

  async shutdown() { await this.stop(); }
}

module.exports = { MarketService, listingRow, lastExpiryCutoff, listingKind };
