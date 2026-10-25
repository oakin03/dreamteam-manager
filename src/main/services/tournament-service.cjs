const { io } = require('socket.io-client');

// Tournaments (game: Match -> Multi Player) live on the game's /event-socket/.
//   getActiveMultiplayerEvents        -> ack: [{ id, name, type, status, minLevel, maxLevel,
//                                        maxPlayers, startsAt, _count.registrations, registrations[{userId}] }]
//   MultiRegistrationJoinRoom         -> ack: true (the page joins before registering)
//   registerMultiplayer {eventId, userId} -> ack: { success, message }
// Status REGISTRATION shows "Register" (or "Quit" once our userId is listed),
// anything else (ONGOING) shows "Look on". There is one tournament type per
// weekday at 15:00 Turkey time; when it ends (~15:45-15:51) its row vanishes
// for 1-2 minutes and comes back as next week's REGISTRATION, which fills up
// within minutes. Reading needs no login; registering uses the account cookie.
//
// This service never unregisters: no "quit"/"leave" event exists in this file.
const SOCKET_URL = 'https://dreamteamph.com';
const EVENT_SOCKET_PATH = '/event-socket/';
const MAIN_SOCKET_PATH = '/socket/';
const ACK_TIMEOUT_MS = 15000;
const POLL_BLANK_MS = 1500;
const POLL_ONGOING_MS = 5000;
const POLL_IDLE_MS = 2000;
const MAX_WAIT_MS = 3 * 60 * 60 * 1000;
const WAIT_LOG_INTERVAL_MS = 5 * 60 * 1000;
const AUTH_CONCURRENCY = 2;
const FULL_RETRY_MS = 30000;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function emitAck(socket, event, payload, timeoutMs = ACK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const done = (error, response) => (error ? reject(error instanceof Error ? error : new Error(String(error))) : resolve(response));
    if (payload === undefined) socket.timeout(timeoutMs).emit(event, done);
    else socket.timeout(timeoutMs).emit(event, payload, done);
  });
}

function waitForConnect(socket, signal, timeoutMs = ACK_TIMEOUT_MS) {
  if (socket.connected) return Promise.resolve(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Tournament socket connection timed out.')), timeoutMs);
    const onConnect = () => finish();
    const onError = error => finish(new Error(`Tournament socket could not connect: ${error?.message || error}`));
    const onAbort = () => finish(abortError());
    function finish(error) {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (error) { socket.close(); reject(error); } else resolve(socket);
    }
    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// "15:00" in Turkey for a UTC timestamp, independent of the PC's time zone.
function trTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// The game's startsAt is stale for some types (seen 2026-10-25: Materials on Wednesday,
// Stone on Friday, Star on Sunday, Ticket on Saturday). The real week, at 15:00 TR:
// Mon APK · Tue Materials · Wed Stone · Thu Star · Fri Exclusive · Sat TK · Sun Ticket.
const WEEKDAY_BY_TYPE = { APK_MATCH: 1, MATERIALS_MATCH: 2, STONE_MATCH: 3, STAR_MATCH: 4, EXCLUSIVE_MATCH: 5, TK_MATCH: 6, TICKET_MATCH: 0 };
const TR_OFFSET_MS = 3 * 3600 * 1000;
// Next 15:00 TR on that weekday (today while today's tournament is still on).
function startFor(type, status, now = Date.now()) {
  const day = WEEKDAY_BY_TYPE[type];
  if (day == null) return null;
  const tr = new Date(now + TR_OFFSET_MS);
  let start = Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate(), 15, 0) - TR_OFFSET_MS;
  let add = (day - tr.getUTCDay() + 7) % 7;
  if (add === 0 && status === 'REGISTRATION' && now >= start) add = 7;
  start += add * 24 * 3600 * 1000;
  return new Date(start).toISOString();
}
// "APK MATCH - Rising Star" → "APK MATCH" (the level band has its own column).
const cleanName = name => String(name || '').replace(/\s*-\s*(Rookie|Rising Star|All-Star|All Star|Legend|Elite(?: II)?)\s*$/i, '').trim();

function normalizeEvent(raw) {
  const registrations = Array.isArray(raw?.registrations) ? raw.registrations.map(r => r?.userId).filter(Boolean) : [];
  const count = Number(raw?._count?.registrations ?? registrations.length);
  return {
    id: raw.id,
    name: cleanName(raw.name || raw.type || 'Tournament') || 'Tournament',
    type: raw.type || null,
    status: raw.status || null,
    minLevel: Number(raw.minLevel),
    maxLevel: Number(raw.maxLevel),
    maxPlayers: Number(raw.maxPlayers || 0),
    count,
    startsAt: startFor(raw.type, raw.status) || raw.startsAt || null,
    userIds: new Set(registrations)
  };
}

const isOpen = event => event.status === 'REGISTRATION';
const hasRoom = event => isOpen(event) && event.count < event.maxPlayers;
const fitsLevel = (event, level) => Number.isFinite(level) && level >= event.minLevel && level <= event.maxLevel;

// What one account should do with the current event list. `knownTypes` are
// the tournament types seen for its level when the run started: a missing
// type means today's tournament just ended and its next registration is
// about to appear.
// `refused` events are not retried in this run; `fullUntil` holds events the
// game just called full (the list can lag behind) until a retry makes sense.
function planAccount(events, { level, userId, knownTypes, refused = new Set(), fullUntil = new Map(), now = Date.now() }) {
  const eligible = events.filter(event => fitsLevel(event, level));
  const registered = eligible.filter(event => event.userIds.has(userId));
  const reportedFull = event => (fullUntil.get(event.id) || 0) > now;
  const candidates = eligible.filter(event => isOpen(event) && !event.userIds.has(userId) && !refused.has(event.id));
  const toRegister = candidates.filter(event => hasRoom(event) && !reportedFull(event));
  const full = candidates.filter(event => !hasRoom(event) || reportedFull(event));
  const ongoing = eligible.filter(event => !isOpen(event));
  const presentTypes = new Set(eligible.map(event => event.type));
  const missingTypes = [...(knownTypes || [])].filter(type => !presentTypes.has(type));
  return { eligible, registered, toRegister, full, ongoing, missingTypes, waiting: ongoing.length > 0 || missingTypes.length > 0 };
}

class TournamentService {
  constructor({ store, credentials, browserService, accountProfile, activity, onChanged, sessions = null, createSocket = (url, options) => io(url, options), pollMs = {} }) {
    this.store = store;
    this.credentials = credentials;
    this.browser = browserService;
    this.sessions = sessions;
    this.accountProfile = accountProfile;
    this.activity = activity;
    this.onChanged = onChanged;
    this.createSocket = createSocket;
    this.pollMs = { blank: POLL_BLANK_MS, ongoing: POLL_ONGOING_MS, idle: POLL_IDLE_MS, ...pollMs };
    this.runtime = { status: 'idle', message: '', startedAt: null, finishedAt: null, accountIds: [] };
    this.accountStates = new Map();
    this.events = [];
    this.eventsAt = null;
    this.controller = null;
    this.run = null;
    this.auth = new Map(); // accountId -> { userId, cookieHeader }, kept for this app session
    this.lastReport = store.getTournamentReport?.() || null;
  }

  log(level, message, account = null, code = null, params = null) {
    this.activity.add({ level, accountId: account?.id || 'tournament', accountName: account?.name || '', taskName: 'Tournament', message, code, params });
  }

  setRuntime(patch) { Object.assign(this.runtime, patch); this.onChanged?.(); }
  setAccount(accountId, patch) {
    this.accountStates.set(accountId, { ...(this.accountStates.get(accountId) || {}), ...patch, updatedAt: new Date().toISOString() });
    this.onChanged?.();
  }

  _userIdToAccountId() {
    const map = new Map();
    const profile = this.accountProfile?.snapshot?.()?.accounts || {};
    for (const account of this.store.getAccounts()) {
      const userId = this.auth.get(account.id)?.userId || profile[account.id]?.userId;
      if (userId) map.set(userId, account.id);
    }
    return map;
  }

  snapshot() {
    const owners = this._userIdToAccountId();
    return {
      runtime: { ...this.runtime },
      accounts: Object.fromEntries(this.accountStates),
      eventsAt: this.eventsAt,
      lastReport: this.lastReport,
      events: this.events.map(({ userIds, ...event }) => ({
        ...event,
        accountIds: [...userIds].map(id => owners.get(id)).filter(Boolean)
      }))
    };
  }

  async _fetchEvents(socket) {
    const list = await emitAck(socket, 'getActiveMultiplayerEvents');
    if (!Array.isArray(list)) throw new Error('Unexpected tournament list reply.');
    this.events = list.map(normalizeEvent).sort((a, b) =>
      String(a.startsAt).localeCompare(String(b.startsAt)) || a.minLevel - b.minLevel || a.name.localeCompare(b.name));
    this.eventsAt = new Date().toISOString();
    this.onChanged?.();
    return this.events;
  }

  // Read-only refresh of the tournament list for the page.
  async refreshEvents() {
    const socket = this.createSocket(SOCKET_URL, { path: EVENT_SOCKET_PATH, transports: ['websocket'], reconnection: false });
    try {
      await waitForConnect(socket);
      return (await this._fetchEvents(socket)).length;
    } finally {
      socket.close();
    }
  }

  async _login(account, signal) {
    const cached = this.auth.get(account.id) || this.sessions?.peek(account.id);
    if (cached) { this.auth.set(account.id, cached); return cached; }
    this.setAccount(account.id, { status: 'login', step: 'login', stepParams: {}, message: 'Signing in…' });
    this.log('info', 'Signing in (headless) to get the session for registration…', account, 'tn.login');
    const log = (level, message) => this.log(level, message, account);
    const result = this.sessions
      ? await this.sessions.get(account, { owner: 'tournament', log })
      : await this.browser.authenticate(account, {
        login: account.login,
        password: this.credentials.decryptSecret(account.passwordEncrypted)
      }, { visible: false, keepOpen: false, owner: `tournament:${account.id}`, log });
    if (signal.aborted) throw abortError();
    if (!result?.userId || !result?.cookieHeader) throw new Error('Session or user ID could not be read.');
    const auth = { userId: result.userId, cookieHeader: result.cookieHeader };
    this.auth.set(account.id, auth);
    this.accountProfile?.merge?.(account.id, { userId: auth.userId });
    return auth;
  }

  async _readLevel(userId, signal) {
    const socket = this.createSocket(SOCKET_URL, { path: MAIN_SOCKET_PATH, transports: ['websocket'], reconnection: false });
    try {
      await waitForConnect(socket, signal);
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off('matchUserData', onData); reject(new Error('Level could not be read.')); }, ACK_TIMEOUT_MS);
        const onData = data => {
          if (!data?.success) return;
          clearTimeout(timer);
          socket.off('matchUserData', onData);
          resolve(Number(data.level));
        };
        socket.on('matchUserData', onData);
        socket.emit('getMatchUserData', { userId });
      });
    } finally {
      socket.close();
    }
  }

  async _prepareAccount(account, signal, sockets) {
    const auth = await this._login(account, signal);
    const level = await this._readLevel(auth.userId, signal);
    if (!Number.isFinite(level)) throw new Error('Level could not be read.');
    this.accountProfile?.merge?.(account.id, { level });
    const socket = this.createSocket(SOCKET_URL, {
      path: EVENT_SOCKET_PATH, transports: ['websocket'], withCredentials: true,
      reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000,
      extraHeaders: { Cookie: auth.cookieHeader }
    });
    sockets.add(socket);
    await waitForConnect(socket, signal);
    await emitAck(socket, 'MultiRegistrationJoinRoom', null).catch(() => null);
    return { account, userId: auth.userId, level, socket, knownTypes: null, refused: new Set(), fullUntil: new Map(), joined: [], fullReplies: [], refusals: [], done: false, waitLoggedAt: 0, waitingKey: null };
  }

  async _register(entry, event) {
    const { account } = entry;
    this.setAccount(account.id, { status: 'registering', step: 'registering', stepParams: { name: event.name }, message: `Registering · ${event.name}…` });
    let reply = null;
    try {
      reply = await emitAck(entry.socket, 'registerMultiplayer', { eventId: event.id, userId: entry.userId });
    } catch (error) {
      reply = { success: false, message: error.message };
    }
    if (reply?.success) {
      entry.joined.push({ id: event.id, name: event.name, startsAt: event.startsAt });
      event.userIds.add(entry.userId);
      event.count += 1;
      this.log('success', `Registered · ${event.name} (Lv ${event.minLevel}-${event.maxLevel}) · starts ${trTime(event.startsAt)} TR.`, account, 'tn.registered', { name: event.name, start: event.startsAt });
      return true;
    }
    const message = reply?.message || 'unknown reply';
    if (/full/i.test(message)) {
      entry.fullUntil.set(event.id, Date.now() + FULL_RETRY_MS);
      entry.fullReplies.push({ name: event.name, message });
      event.count = Math.max(event.count, event.maxPlayers);
      this.log('warning', `${event.name} filled up before registration (${message}).`, account, 'tn.full', { name: event.name });
    } else {
      // Not retried in this run: the game refused for a reason we can't fix.
      entry.refused.add(event.id);
      entry.refusals.push({ name: event.name, message });
      this.log('warning', `Registration refused · ${event.name} · ${message}.`, account, 'tn.refused', { name: event.name, message });
    }
    return false;
  }

  _waitCode(plan) {
    if (plan.ongoing.length) return ['tn.waitLookOn', { name: plan.ongoing[0].name }];
    return ['tn.waitBlank', { type: (plan.missingTypes[0] || '').replace(/_/g, ' ') }];
  }

  _describeWait(plan) {
    const parts = [];
    for (const event of plan.ongoing) parts.push(`${event.name} is in progress (Look on)`);
    for (const type of plan.missingTypes) parts.push(`${type.replace(/_/g, ' ')} just ended · next registration should appear in 1-2 minutes`);
    return parts.join(' · ');
  }

  async start(accountIds = [], { source = 'manual' } = {}) {
    if (this.controller) throw new Error('Tournament registration is already running.');
    const accounts = this.store.getAccounts().filter(account => accountIds.includes(account.id));
    if (!accounts.length) throw new Error('Select at least one account.');

    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.accountStates = new Map(accounts.map(account => [account.id, { status: 'queued', step: 'queued', stepParams: {}, message: 'Waiting to start…', joined: [], level: null }]));
    this.setRuntime({ status: 'running', step: 'reading', stepParams: {}, message: 'Reading tournaments…', startedAt: new Date().toISOString(), finishedAt: null, accountIds: accounts.map(a => a.id) });
    this.log('info', `Tournament registration started · ${accounts.length} account(s).`, null, 'tn.started', { count: accounts.length });
    this.run = this._run(accounts, signal, source).finally(() => { this.controller = null; this.run = null; });
    return this.snapshot();
  }

  async _run(accounts, signal, source = 'manual') {
    const sockets = new Set();
    const startedAt = Date.now();
    const entries = [];
    let runError = null;
    try {
      const watch = this.createSocket(SOCKET_URL, { path: EVENT_SOCKET_PATH, transports: ['websocket'], reconnection: true });
      sockets.add(watch);
      await waitForConnect(watch, signal);
      const first = await this._fetchEvents(watch);
      const statuses = first.reduce((acc, e) => ({ ...acc, [e.status]: (acc[e.status] || 0) + 1 }), {});
      this.log('info', `${first.length} tournaments listed · ${Object.entries(statuses).map(([k, v]) => `${v} ${k}`).join(' · ')}.`, null, 'tn.listed', { count: first.length, open: statuses.REGISTRATION || 0, playing: first.length - (statuses.REGISTRATION || 0) });

      // Sign in and read levels, a couple of accounts at a time.
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(AUTH_CONCURRENCY, accounts.length) }, async () => {
        while (next < accounts.length) {
          const account = accounts[next++];
          if (signal.aborted) return;
          try {
            const entry = await this._prepareAccount(account, signal, sockets);
            entries.push(entry);
            this.setAccount(account.id, { status: 'ready', level: entry.level, step: 'ready', stepParams: { level: entry.level }, message: `Level ${entry.level}` });
          } catch (error) {
            if (error?.name === 'AbortError') return;
            this.setAccount(account.id, { status: 'error', step: 'error', stepParams: { error: error.message }, message: error.message });
            this.log('error', `Could not prepare: ${error.message}`, account, 'tn.prepFailed', { error: error.message });
          }
        }
      }));
      if (signal.aborted) throw abortError();

      for (const entry of entries) {
        const eligible = this.events.filter(event => fitsLevel(event, entry.level));
        entry.knownTypes = new Set(eligible.map(event => event.type));
        if (!eligible.length) {
          entry.done = true;
          this.setAccount(entry.account.id, { status: 'done', step: 'outcome', stepParams: { outcome: 'no-tournament', details: `Lv ${entry.level}` }, message: `No tournament for level ${entry.level}.` });
          this.log('warning', `No tournament accepts level ${entry.level}.`, entry.account, 'tn.noTournament', { level: entry.level });
        }
      }

      for (;;) {
        if (signal.aborted) throw abortError();
        const active = entries.filter(entry => !entry.done);
        if (!active.length) break;
        let anyBlank = false;
        let anyWaiting = false;

        for (const entry of active) {
          const plan = planAccount(this.events, entry);
          for (const event of plan.toRegister) {
            if (signal.aborted) throw abortError();
            await this._register(entry, event);
          }
          const after = planAccount(this.events, entry);
          const summary = this._summary(entry, after);
          if (after.waiting) {
            anyWaiting = true;
            if (after.missingTypes.length) anyBlank = true;
            const reason = this._describeWait(after);
            // Log when the reason changes, then every few minutes while waiting.
            if (reason !== entry.waitingKey || Date.now() - entry.waitLoggedAt >= WAIT_LOG_INTERVAL_MS) {
              this.log('info', `Waiting · ${reason}.${summary ? ` ${summary}` : ''}`, entry.account, ...this._waitCode(after));
              entry.waitingKey = reason;
              entry.waitLoggedAt = Date.now();
            }
            const [waitStep, waitParams] = this._waitCode(after);
            this.setAccount(entry.account.id, { status: 'waiting', level: entry.level, joined: entry.joined, step: waitStep.slice(3), stepParams: waitParams, message: `Waiting · ${reason}` });
          } else {
            entry.done = true;
            const result = this._accountOutcome(entry.account, entry, null);
            this.setAccount(entry.account.id, { status: 'done', level: entry.level, joined: entry.joined, step: 'outcome', stepParams: { outcome: result.outcome, details: result.reason }, message: summary || 'Nothing to register.' });
            this.log(entry.joined.length ? 'success' : 'info', `Finished · ${summary || 'nothing to register'}.`, entry.account, 'tn.accountDone', { outcome: result.outcome, details: result.reason });
          }
        }

        if (!entries.some(entry => !entry.done)) break;
        if (Date.now() - startedAt > MAX_WAIT_MS) {
          for (const entry of entries.filter(e => !e.done)) {
            this.setAccount(entry.account.id, { status: 'error', step: 'outcome', stepParams: { outcome: 'timeout', details: null }, message: 'Gave up waiting after 3 hours.' });
            this.log('error', 'Gave up waiting for the next tournament registration after 3 hours.', entry.account, 'tn.gaveUp');
          }
          break;
        }
        const waitingCount = entries.filter(e => !e.done).length;
        this.setRuntime({ step: anyWaiting ? 'waiting' : 'registering', stepParams: { count: waitingCount }, message: anyWaiting
          ? `Waiting for today's tournament · ${waitingCount} account(s) · checking every ${(anyBlank ? this.pollMs.blank : this.pollMs.ongoing) / 1000}s`
          : `Registering · ${waitingCount} account(s)…` });
        await sleep(anyBlank ? this.pollMs.blank : anyWaiting ? this.pollMs.ongoing : this.pollMs.idle, signal);
        await this._fetchEvents(watch).catch(error => this.log('warning', `Tournament list could not be read (${error.message}) · retrying.`, null, 'tn.listFailed', { error: error.message }));
      }

      const joined = entries.reduce((sum, entry) => sum + entry.joined.length, 0);
      this.setRuntime({ status: 'done', step: 'done', stepParams: { joined, seconds: Math.round((Date.now() - startedAt) / 1000) }, message: `Finished · ${joined} new registration(s) · ${Math.round((Date.now() - startedAt) / 1000)}s`, finishedAt: new Date().toISOString() });
      this.log('success', `Tournament registration finished · ${joined} new registration(s).`, null, 'tn.finished', { joined });
    } catch (error) {
      if (error?.name === 'AbortError') {
        for (const [id, state] of this.accountStates) {
          if (!['done', 'error'].includes(state.status)) this.setAccount(id, { status: 'stopped', step: 'outcome', stepParams: { outcome: 'stopped', details: null }, message: 'Stopped by user.' });
        }
        this.setRuntime({ status: 'stopped', step: 'stopped', stepParams: {}, message: 'Stopped by user.', finishedAt: new Date().toISOString() });
        this.log('warning', 'Tournament registration stopped by user.', null, 'tn.stopped');
      } else {
        runError = error.message;
        this.setRuntime({ status: 'error', step: 'error', stepParams: { error: error.message }, message: error.message, finishedAt: new Date().toISOString() });
        this.log('error', `Tournament registration failed: ${error.message}`, null, 'tn.failed', { error: error.message });
      }
    } finally {
      for (const socket of sockets) socket.close();
      this._saveReport(accounts, entries, { source, startedAt, runError });
      this.onChanged?.();
    }
  }

  // One line per account: did it register, and if not, why not.
  _accountOutcome(account, entry, runError) {
    const state = this.accountStates.get(account.id) || {};
    const plan = entry && Number.isFinite(entry.level) ? planAccount(this.events, entry) : null;
    const joined = entry?.joined.map(e => e.name) || [];
    const already = plan ? plan.registered.map(e => e.name).filter(name => !joined.includes(name)) : [];
    const full = [...new Set([...(plan?.full.map(e => e.name) || []), ...(entry?.fullReplies.map(r => r.name) || [])])];
    const refused = entry?.refusals || [];
    const base = { accountId: account.id, name: account.name, level: entry?.level ?? state.level ?? null, joined, already, full, refused, reason: null };
    if (joined.length) return { ...base, outcome: 'registered' };
    if (state.status === 'stopped') return { ...base, outcome: 'stopped' };
    if (!entry) return { ...base, outcome: 'error', reason: state.status === 'error' ? state.message : runError };
    if (state.status === 'error') return { ...base, outcome: 'timeout' };
    if (plan && !plan.eligible.length) return { ...base, outcome: 'no-tournament', reason: `Lv ${entry.level}` };
    if (refused.length) return { ...base, outcome: 'refused', reason: refused.map(r => `${r.name}: ${r.message}`).join(' · ') };
    if (full.length) return { ...base, outcome: 'full', reason: full.join(', ') };
    if (already.length) return { ...base, outcome: 'already', reason: already.join(', ') };
    return { ...base, outcome: 'nothing' };
  }

  _saveReport(accounts, entries, { source, startedAt, runError }) {
    const rows = accounts.map(account => this._accountOutcome(account, entries.find(e => e.account.id === account.id), runError));
    const report = {
      source,
      status: this.runtime.status,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      registered: rows.filter(r => r.outcome === 'registered').length,
      accounts: rows
    };
    this.lastReport = report;
    this.store.saveTournamentReport?.(report);
    // Same grouping as the page: already registered still has its seat.
    const inTournament = r => r.outcome === 'registered' || r.outcome === 'already';
    const ok = rows.filter(inTournament).map(r => (r.outcome === 'already' ? `${r.name} (already)` : r.name));
    const not = rows.filter(r => !inTournament(r)).map(r => `${r.name} (${r.outcome}${r.reason ? `: ${r.reason}` : ''})`);
    this.log(not.length ? 'warning' : 'success', `Report · registered: ${ok.join(', ') || '—'} · not registered: ${not.join(' · ') || '—'}.`, null, 'tn.report',
      { rows: rows.map(r => ({ name: r.name, outcome: r.outcome, details: r.reason })) });
  }

  _summary(entry, plan) {
    const parts = [];
    if (entry.joined.length) parts.push(`joined ${entry.joined.map(e => e.name).join(', ')}`);
    const before = plan.registered.filter(event => !entry.joined.some(j => j.id === event.id));
    if (before.length) parts.push(`already registered: ${before.map(e => e.name).join(', ')}`);
    if (plan.full.length) parts.push(`${plan.full.length} full`);
    return parts.join(' · ');
  }

  // For the scheduler: starts a run and resolves when every account has
  // registered, hit a full tournament or failed. `signal` stops the run.
  async runAndWait(accountIds, { signal = null } = {}) {
    if (this.controller) throw new Error('Tournament registration is already running (started from the Tournament page).');
    await this.start(accountIds, { source: 'schedule' });
    const onAbort = () => this.stop();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.run;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    return this.snapshot();
  }

  async stop() {
    if (!this.controller) return true;
    this.controller.abort();
    await this.run?.catch(() => {});
    return true;
  }

  async shutdown() { await this.stop(); }
}

module.exports = { startFor, cleanName,  TournamentService, planAccount, normalizeEvent, trTime };
