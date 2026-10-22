const { io } = require('socket.io-client');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

// Trading Hall listings come from the game's public market socket: the page UI
// emits market:getMarketPlayers and the server answers with a separate
// market:marketPlayersData event (no ack, no page number in the reply), 8
// tickets per page, sorted by price. No login is needed, so the scan runs
// without a browser: a small pool of sockets, one request in flight per
// socket so every reply belongs to the request that socket just sent.
const SOCKET_URL = 'https://dreamteamph.com';
const SOCKET_PATH = '/socket/';
const REQUEST_EVENT = 'market:getMarketPlayers';
const REPLY_EVENT = 'market:marketPlayersData';
const PAGE_SIZE = 8;
const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 15000;
const PAGE_ATTEMPTS = 3;
const CURRENCY_LABELS = { APK_TICKET: 'APK', TICKET: 'TIX' };
const SCAN_LABELS = { APK_TICKET: 'APK', TICKET: 'TIX', all: 'All' };
const PROGRESS_LOG_STEPS = [25, 50, 75];

const fmt = value => Number(value || 0).toLocaleString('en-US');
const seconds = ms => `${Math.max(0, Math.round(ms / 1000))}s`;

function ticketToRow(ticket, sourcePage) {
  const player = ticket?.player || {};
  const price = Number(ticket?.price);
  const salary = Number(ticket?.signedSalary);
  const currency = CURRENCY_LABELS[ticket?.paymentMode] || ticket?.paymentMode || null;
  if (!Number.isFinite(price) || !Number.isFinite(salary) || !currency) return null;
  const base = Number(player.newBaseSalary);
  const hasBase = Number.isFinite(base) && base > 0;
  return {
    id: ticket.id,
    playerId: ticket.playerId || player.id || null,
    name: String(player.visualName || player.name || '').trim(),
    position: player.position ? String(player.position).toUpperCase() : null,
    grade: player.rating ? String(player.rating).toUpperCase() : null,
    salary,
    // The game shows its BASE badge when signedSalary <= newBaseSalary.
    base: hasBase ? base : null,
    // How far the salary is above (+) or below (-) base, in percent.
    basePct: hasBase ? Math.round(((salary - base) / base) * 1000) / 10 : null,
    // Set from the game's own basePlayersOnly listing after the scan.
    isBase: null,
    value: null,
    valueChange: null,
    price,
    currency,
    seller: ticket.user?.teamName || null,
    sourcePage
  };
}

class TradingHallService {
  constructor({ store, credentials, activity, onChanged, createSocket = (url, options) => io(url, options), concurrency = CONCURRENCY, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
    this.store = store;
    this.credentials = credentials;
    this.activity = activity;
    this.onChanged = onChanged;
    this.createSocket = createSocket;
    this.concurrency = concurrency;
    this.requestTimeoutMs = requestTimeoutMs;
    this.runtime = { status: 'idle', phase: null, page: 0, totalPages: 0, count: 0, message: '', pagesPerSecond: null, etaSeconds: null, startedAt: null, finishedAt: null };
    this.controller = null;
    this.rows = [];
    this.lastUiEmitAt = 0;
  }

  snapshot() { return { ...this.runtime }; }
  // Auto Buy reads the cheapest listings of each watched player; those replace the
  // player's rows (same currency, up to the highest price read) so the hall stays
  // current between full scans. Ignored while a full scan runs.
  mergeTickets(playerIds, currency, tickets) {
    if (['starting', 'running'].includes(this.runtime.status)) return;
    const fresh = (tickets || []).map(t => ticketToRow(t, 1)).filter(r => r && r.currency === currency);
    for (const r of fresh) r.isBase = r.base != null && r.salary <= r.base;
    const ids = new Set(playerIds);
    const cutoff = fresh.length >= 8 ? Math.max(...fresh.map(r => r.price)) : Infinity;
    const keep = this.rows.filter(r => !(ids.has(r.playerId) && r.currency === currency && r.price <= cutoff));
    const seen = new Set(keep.map(r => r.id));
    this.rows = [...keep, ...fresh.filter(r => !seen.has(r.id))].sort((a, b) => a.price - b.price);
    this.onChanged?.();
  }

  rowsSnapshot() { return ['starting', 'running'].includes(this.runtime.status) ? [] : this.rows; }
  clearRows() {
    this.rows = [];
    this.store.saveTradingRows([]);
    this.onChanged?.();
  }

  tradeAccountSafe() {
    const a = this.store.getTradeAccount();
    if (!a) return null;
    const { passwordEncrypted, ...safe } = a;
    return safe;
  }

  log(level, message, code = null, params = null) {
    this.activity.add({ level, accountId: 'trading-hall', accountName: '', taskName: 'Trading Hall', message, code, params });
  }

  setRuntime(patch, { emit = true } = {}) {
    Object.assign(this.runtime, patch);
    if (emit) this.onChanged?.();
  }

  emitProgress(force = false) {
    const now = Date.now();
    if (!force && now - this.lastUiEmitAt < 250) return;
    this.lastUiEmitAt = now;
    this.onChanged?.();
  }

  async saveAccount({ name, login, password }) {
    const old = this.store.getTradeAccount();
    const account = {
      id: old?.id || 'trade-account',
      name: String(name || 'Trade Account').trim() || 'Trade Account',
      login: String(login || '').trim(),
      passwordEncrypted: password ? this.credentials.encryptSecret(String(password)) : old?.passwordEncrypted,
      updatedAt: new Date().toISOString()
    };
    if (!account.login || !account.passwordEncrypted) throw new Error('Trade account login and password are required.');
    this.store.saveTradeAccount(account);
    this.onChanged?.();
    return this.tradeAccountSafe();
  }

  _connect(signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const socket = this.createSocket(SOCKET_URL, { path: SOCKET_PATH, transports: ['websocket'], reconnection: false, timeout: this.requestTimeoutMs });
      const cleanup = () => { socket.off('connect', onConnect); socket.off('connect_error', onError); signal.removeEventListener('abort', onAbort); };
      const onConnect = () => { cleanup(); resolve(socket); };
      const onError = error => { cleanup(); socket.close(); reject(new Error(`Market socket could not connect: ${error?.message || error}`)); };
      const onAbort = () => { cleanup(); socket.close(); reject(abortError()); };
      socket.on('connect', onConnect);
      socket.on('connect_error', onError);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  _request(socket, payload, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const timer = setTimeout(() => finish(new Error('Market request timed out.')), this.requestTimeoutMs);
      const finish = (error, data) => {
        clearTimeout(timer);
        socket.off(REPLY_EVENT, onReply);
        socket.off('disconnect', onDisconnect);
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(data);
      };
      const onReply = data => finish(null, data);
      const onDisconnect = () => finish(new Error('Market socket disconnected.'));
      const onAbort = () => finish(abortError());
      socket.on(REPLY_EVENT, onReply);
      socket.on('disconnect', onDisconnect);
      signal.addEventListener('abort', onAbort, { once: true });
      socket.emit(REQUEST_EVENT, payload);
    });
  }

  // Fetches every page of one market query with the shared socket pool.
  // `workers` hold one socket each and are reused between passes.
  async _scanQuery(query, { workers, sockets, signal, limit, phase, label }) {
    const pass = phase === 'base' ? 'th.base' : 'th.listings';
    const hasLimit = Number.isFinite(limit);
    const pages = new Map();
    let stoppedAt = null;

    // A timed-out socket may still deliver its late reply, which would be
    // read as the answer to its next request; such sockets are replaced.
    const fetchPage = async (worker, page) => {
      let lastError = null;
      for (let attempt = 1; attempt <= PAGE_ATTEMPTS; attempt++) {
        if (signal.aborted) throw abortError();
        try {
          if (!worker.socket) {
            worker.socket = await this._connect(signal);
            sockets.add(worker.socket);
          }
          const data = await this._request(worker.socket, { ...query, page }, signal);
          if (!Array.isArray(data?.tickets)) throw new Error('Unexpected Trading Hall reply.');
          return data;
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          lastError = error;
          if (worker.socket) { sockets.delete(worker.socket); worker.socket.close(); worker.socket = null; }
          if (attempt < PAGE_ATTEMPTS) {
            this.log('warning', `${label}: page ${page} failed (${error.message}) · retrying on a new connection (${attempt + 1}/${PAGE_ATTEMPTS}).`, 'th.retry', { page, attempt: attempt + 1, max: PAGE_ATTEMPTS });
            await sleep(attempt * 400);
          }
        }
      }
      throw new Error(`Page ${page} could not be loaded: ${lastError?.message || 'market error'}`);
    };

    const startedAt = Date.now();
    const first = await fetchPage(workers[0], 1);
    const total = Number(first.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    let lastPage = totalPages;
    this.log('info', `${label}: ${fmt(total)} listings on ${fmt(totalPages)} pages · ${workers.length} connections.`, `${pass}Listed`, { total, pages: totalPages });

    let count = 0;
    let nextLog = 0;
    const accept = (page, data) => {
      const rows = [];
      for (const ticket of data.tickets) {
        const row = ticketToRow(ticket, page);
        if (!row) continue;
        // Listings are sorted by price, so nothing after this page can be cheaper.
        if (hasLimit && row.price >= limit) {
          if (stoppedAt == null || page < stoppedAt) stoppedAt = page;
          lastPage = Math.min(lastPage, page);
          break;
        }
        rows.push(row);
      }
      if (data.tickets.length < PAGE_SIZE) lastPage = Math.min(lastPage, page);
      pages.set(page, rows);
      count += rows.length;

      const done = pages.size;
      const elapsed = Date.now() - startedAt;
      const rate = elapsed > 0 ? done / (elapsed / 1000) : null;
      const remaining = Math.max(0, lastPage - done);
      const eta = rate ? remaining / rate : null;
      this.setRuntime({
        status: 'running', phase, page: done, totalPages: lastPage, count,
        pagesPerSecond: rate ? Math.round(rate * 10) / 10 : null,
        etaSeconds: eta == null ? null : Math.round(eta),
        message: `${label} · ${fmt(done)}/${fmt(lastPage)} pages · ${fmt(count)} listings${rate ? ` · ${rate.toFixed(1)} pages/s` : ''}${eta != null && remaining ? ` · ~${seconds(eta * 1000)} left` : ''}`
      }, { emit: false });
      this.emitProgress(false);

      const percent = Math.floor((done / lastPage) * 100);
      while (nextLog < PROGRESS_LOG_STEPS.length && percent >= PROGRESS_LOG_STEPS[nextLog]) {
        // A price limit can shrink lastPage and jump straight to 100%; the
        // completion line covers that, so only log steps with work left.
        if (lastPage >= 40 && done < lastPage) {
          this.log('info', `${label}: ${PROGRESS_LOG_STEPS[nextLog]}% · ${fmt(done)}/${fmt(lastPage)} pages · ${fmt(count)} listings · ${rate.toFixed(1)} pages/s · ~${seconds(eta * 1000)} left.`, 'th.progress', { pct: PROGRESS_LOG_STEPS[nextLog], count, eta: Math.round(eta) });
        }
        nextLog++;
      }
    };

    accept(1, first);
    let nextPage = 2;
    let failure = null;
    const active = workers.slice(0, Math.max(1, Math.min(workers.length, lastPage - 1)));
    // Workers stop at the first failure and are all awaited, so no request
    // is still running once the sockets are closed.
    await Promise.all(active.map(async worker => {
      try {
        while (!failure && nextPage <= lastPage) {
          const page = nextPage++;
          const data = await fetchPage(worker, page);
          if (page <= lastPage) accept(page, data);
        }
      } catch (error) {
        failure ||= error;
      }
    }));
    if (failure) {
      failure.partialPages = pages;
      throw failure;
    }
    return { pages, lastPage, totalPages, stoppedAt, elapsedMs: Date.now() - startedAt };
  }

  async start({ stopPrice = 9999, scanCurrency = 'APK_TICKET' } = {}) {
    if (this.controller) throw new Error('Trading Hall scan is already running.');

    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.rows = [];
    this.store.saveTradingRows([]);
    this.setRuntime({
      status: 'starting', phase: 'listings', page: 0, totalPages: 0, count: 0, pagesPerSecond: null, etaSeconds: null, baseCount: null, stoppedByPrice: false, durationSeconds: null, error: null,
      message: 'Connecting to the game market…', startedAt: new Date().toISOString(), finishedAt: null
    });

    const limit = Number(stopPrice);
    const hasLimit = Number.isFinite(limit);
    const query = { search: '', sort: 'asc', basePlayersOnly: false };
    if (scanCurrency && scanCurrency !== 'all') query.paymentMode = scanCurrency;
    const currencyLabel = SCAN_LABELS[scanCurrency] || scanCurrency || 'All';
    const sockets = new Set();
    const workers = Array.from({ length: this.concurrency }, () => ({ socket: null }));
    const startedAt = Date.now();
    let listing = null;
    this.log('info', `Scan started · ${currencyLabel} · stop at price ${hasLimit ? fmt(limit) : '—'} · ${this.concurrency} parallel connections.`, 'th.start', { currency: currencyLabel, stop: hasLimit ? limit : null });

    try {
      try {
        listing = await this._scanQuery(query, { workers, sockets, signal, limit, phase: 'listings', label: 'Listings' });
      } catch (error) {
        if (error?.partialPages) listing = { pages: error.partialPages, lastPage: Infinity };
        throw error;
      }
      if (listing.stoppedAt != null) {
        this.log('info', `Price limit ${fmt(limit)} reached on page ${fmt(listing.stoppedAt)} · the remaining ${fmt(listing.totalPages - listing.stoppedAt)} pages are not needed.`, 'th.priceStop', { price: limit, page: listing.stoppedAt });
      }
      this.rows = this._collectRows(listing.pages, listing.lastPage);
      this.log('info', `Listings read in ${seconds(listing.elapsedMs)} · ${fmt(this.rows.length)} listings.`, 'th.listingsDone', { count: this.rows.length, seconds: Math.round(listing.elapsedMs / 1000) });

      // Second, short pass: the game's own "Base only" listing marks which
      // tickets get the BASE badge (it also checks ranking/injury we can't see).
      if (signal.aborted) throw abortError();
      this.setRuntime({ status: 'running', phase: 'base', page: 0, totalPages: 0, pagesPerSecond: null, etaSeconds: null, message: 'Marking base players…' });
      try {
        const base = await this._scanQuery({ ...query, basePlayersOnly: true }, { workers, sockets, signal, limit, phase: 'base', label: 'Base players' });
        const baseIds = new Set();
        for (const rows of base.pages.values()) for (const row of rows) baseIds.add(row.id);
        for (const row of this.rows) row.isBase = baseIds.has(row.id);
        this.log('info', `Base players marked in ${seconds(base.elapsedMs)} · ${fmt(this.rows.filter(row => row.isBase).length)} base listings.`, 'th.baseDone', { count: this.rows.filter(row => row.isBase).length });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        this.log('warning', `Base players could not be marked (${error.message}) · the "Base only" filter is unavailable for this scan.`, 'th.baseFailed', { error: error.message });
      }

      if (signal.aborted) throw abortError();
      this.store.saveTradingRows(this.rows);
      const baseCount = this.rows.filter(row => row.isBase).length;
      this.setRuntime({
        status: 'done', phase: null, page: listing.lastPage, totalPages: listing.lastPage, count: this.rows.length,
        pagesPerSecond: null, etaSeconds: null, baseCount, stoppedByPrice: listing.stoppedAt != null,
        durationSeconds: Math.round((Date.now() - startedAt) / 1000), error: null,
        message: `${listing.stoppedAt != null ? 'Stopped at price limit' : 'Completed'} · ${fmt(this.rows.length)} listings · ${fmt(baseCount)} base · ${seconds(Date.now() - startedAt)}`,
        finishedAt: new Date().toISOString()
      });
      this.log('success', `Trading Hall scan completed in ${seconds(Date.now() - startedAt)} · ${fmt(this.rows.length)} listings · ${fmt(baseCount)} base.`, 'th.done', { count: this.rows.length, base: baseCount, seconds: Math.round((Date.now() - startedAt) / 1000) });
      return this.rows;
    } catch (error) {
      // Keep whatever was already scanned.
      if (!this.rows.length && listing?.pages) this.rows = this._collectRows(listing.pages, Infinity);
      this.store.saveTradingRows(this.rows);
      if (error?.name === 'AbortError') {
        this.setRuntime({ status: 'stopped', phase: null, count: this.rows.length, etaSeconds: null, message: `Stopped · ${fmt(this.rows.length)} listings kept`, finishedAt: new Date().toISOString() });
        this.log('warning', `Trading Hall scan stopped by user · ${fmt(this.rows.length)} listings kept.`, 'th.stopped', { count: this.rows.length });
      } else {
        this.setRuntime({ status: 'error', phase: null, count: this.rows.length, etaSeconds: null, error: error.message, message: error.message, finishedAt: new Date().toISOString() });
        this.log('error', `Trading Hall scan failed: ${error.message} · ${fmt(this.rows.length)} listings kept.`, 'th.failed', { error: error.message, count: this.rows.length });
      }
      throw error;
    } finally {
      for (const socket of sockets) socket.close();
      this.controller = null;
      this.emitProgress(true);
    }
  }

  // Page order keeps the price order; a listing that moved between two pages
  // while the scan ran would otherwise show up twice.
  _collectRows(pages, lastPage) {
    const seen = new Set();
    const rows = [];
    for (const page of [...pages.keys()].sort((a, b) => a - b)) {
      if (page > lastPage) continue;
      for (const row of pages.get(page)) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    }
    return rows;
  }

  async stop() {
    if (!this.controller) return true;
    this.log('info', 'Stop requested · finishing the pages in flight…', 'th.stopRequested');
    this.controller.abort();
    const end = Date.now() + 15000;
    while (this.controller && Date.now() < end) await sleep(100);
    return true;
  }
}

module.exports = { TradingHallService, ticketToRow };
