const { GameSocket } = require('./game-socket.cjs');
const { TradeGameAccount, sleep, abortError } = require('./trade-game-client.cjs');
const R = require('./trade-rules.cjs');

// Auto Trade over the game's socket (no browser). Main scouts and turns its players
// into star cards; sides (highest TK first) scout too and swap players with main in
// password-protected trade rooms the side hosts. Every step re-reads rosters from
// the game, so a stopped or failed run continues from where it was.
const DEFAULTS = {
  sideToMainRoleIds: ['card'],
  mainToSideRoleIds: ['sellable'],   // + the "Stok" role, added by name at first use
  maxPrice: 100,
  roomDescription: '923589325',
  roomPassword: '32958209',
  loopMode: 'off',                   // off | count | infinite
  loopCount: 2,
  baseAsSellable: false,             // team players signed at/below Base count as Satılabilir
  baseProjected: true                // …compared with tomorrow's Base (Base × 0.95)
};
const LIST_DEFAULTS = { sellable: { price: 20, currency: 'APK' }, stock: { price: 99999, currency: 'TIX' } };
const MAX_TRADE_ROUNDS = 12;

const ACCEPT_WAIT_MS = 7000;
const ACCEPT_TRIES = 3;

class UserFixError extends Error { constructor(message, code, params) { super(message); this.userFix = true; this.code = code; this.params = params || {}; } }

class AutoTradeEngine {
  constructor({ store, credentials, activity, sessions, accountProfile, onChanged, onAttention, onScout, onCycleEnd, createSocket, now = () => Date.now(), timing = {} }) {
    this.store = store;
    this.credentials = credentials;
    this.activity = activity;
    this.sessions = sessions;
    this.accountProfile = accountProfile;
    // The page receives the Auto Trade state only when this revision moved.
    this.revision = 0;
    this.onChanged = () => { this.revision++; onChanged?.(); };
    this.onAttention = onAttention;   // (kind, text) → bring the window forward / flash
    this.onScout = onScout;           // (accountId, freeAgentReply) → Scout page shows it
    this.onCycleEnd = onCycleEnd;     // async () → the Cards page scan of the main account
    this.createSocket = createSocket;
    this.now = now;
    this.timing = { stepMs: 350, ...timing };
    this.conns = new Map();
    this.controller = null;
    this.pauseGate = null;
    this.listingWaiter = null;
    const saved = this.store.getAutoTrade2();
    this.state = saved?.run || null;
    this.cardTotals = saved?.cardTotals || {};
    this.lastConfig = saved?.lastConfig || null;
    // An app restart in the middle of a run leaves it continuable, never "running".
    if (this.state && ['running', 'paused', 'awaitingListing', 'stopping'].includes(this.state.status)) {
      this.state.status = 'stopped';
      this.state.message = 'interrupted';
    }
    if (this.state?.status === 'done') { this.state.step = 'done'; this.state.stepParams = {}; }
  }

  // ---------- state ----------
  _save() {
    this.store.saveAutoTrade2({ version: 2, run: this.state, cardTotals: this.cardTotals, lastConfig: this.lastConfig });
    this.onChanged?.();
  }

  snapshot() {
    const now = this.now();
    const run = this.state ? JSON.parse(JSON.stringify(this.state)) : null;
    if (run) {
      for (const [id, acc] of Object.entries(run.accounts)) {
        const open = this.conns.has(id) && acc.openedAt ? now - Date.parse(acc.openedAt) : 0;
        acc.openSeconds = Math.round(((acc.openMs || 0) + open) / 1000);
        acc.connected = this.conns.has(id);
      }
      delete run.config.roomPasswordEncrypted;
    }
    const last = this.lastConfig ? { ...this.lastConfig } : null;
    if (last) {
      // The form shows the saved room password (masked, with a show button).
      last.hasPassword = Boolean(last.roomPasswordEncrypted);
      try { last.roomPassword = last.roomPasswordEncrypted ? this.credentials.decryptSecret(last.roomPasswordEncrypted) : null; } catch { last.roomPassword = null; }
      delete last.roomPasswordEncrypted;
    }
    return { run, cardTotals: JSON.parse(JSON.stringify(this.cardTotals)), lastConfig: last, defaults: { ...DEFAULTS, roomPassword: undefined }, listDefaults: LIST_DEFAULTS };
  }

  _acc(id) { return this.state.accounts[id]; }
  _name(id) { return this.store.getAccounts().find(a => a.id === id)?.name || id; }

  _log(level, code, params, message, accountId = null) {
    this.activity.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName: 'Auto Trade', code, params, message });
  }

  _step(step, stepParams = {}, accountId = null) {
    if (!this.state) return;
    this.state.step = step;
    this.state.stepParams = stepParams;
    if (accountId) this.state.activeId = accountId;
    this.onChanged?.();
  }

  _roleMap() { return R.roleMapFrom(this.store.getCardMetadata?.() || {}); }
  _teamPlayers() { return R.teamPlayersFrom(this.store.getCards?.() || {}, this.store.getCardMetadata?.() || {}); }
  _roleNames() { return new Map((this.store.getCardRoles?.() || []).map(r => [r.id, r.name])); }

  _defaultRoles() {
    const roles = this.store.getCardRoles?.() || [];
    const byName = n => roles.find(r => String(r.name).toLocaleLowerCase('tr-TR') === n)?.id;
    return {
      sideToMainRoleIds: [byName('kart') || 'card'],
      mainToSideRoleIds: [byName('satılabilir') || 'sellable', byName('stok')].filter(Boolean)
    };
  }

  // ---------- pre-checks (no login: rosters and TK are readable by user id) ----------
  _userIdOf(accountId) { return this.store.getAccountProfile?.()?.accounts?.[accountId]?.userId || null; }

  async preflight({ accountIds, config = {} } = {}) {
    const accounts = this.store.getAccounts().filter(a => accountIds.includes(a.id));
    const roleMap = this._roleMap();
    const roleNames = this._roleNames();
    const cfg = this._config(config);
    const out = [];
    let anon = null;
    try {
      anon = await GameSocket.open({ createSocket: this.createSocket });
      for (const account of accounts) {
        let userId = this._userIdOf(account.id);
        if (!userId) userId = (await this.sessions.get(account, { owner: 'auto-trade' })).userId;
        const roster = R.rosterOf(await anon.ack('getTeamOptimized', { userId }));
        const info = await anon.call('getUserBasicInfo', { userId }, 'userBasicInfo').catch(() => null);
        out.push({
          id: account.id, name: account.name, userId, funds: Number(info?.funds) || null,
          total: roster.total, starters: roster.starters.length,
          bench: roster.bench.map(p => this._row(p, cfg, roleMap, roleNames, { status: 'existing', block: R.tradeBlock(p) }))
        });
      }
    } finally { try { anon?.close(); } catch {} }
    return { accounts: out };
  }

  _config(raw = {}) {
    const last = this.lastConfig || {};
    const roles = this._defaultRoles();
    const merged = { ...DEFAULTS, ...roles, ...last, ...raw };
    return { ...merged, ...R.normalizeConfig(merged) };
  }

  _row(p, cfg, roleMap = this._roleMap(), roleNames = this._roleNames(), extra = {}) {
    const roleIds = roleMap.get(p.id) || [];
    return {
      id: p.id, name: p.visualName || p.name, salary: R.salaryOf(p), price: Number(p.baseSalary) || null, base: Number(p.newBaseSalary) || null,
      rating: p.rating, position: p.position,
      dir: R.classify(p, cfg, roleMap, this._teamPlayers()), roleIds, roles: roleIds.map(id => roleNames.get(id) || id),
      status: 'bought', ...extra
    };
  }

  // ---------- controls ----------
  isRunning() { return Boolean(this.controller); }

  async start(options = {}) {
    if (this.controller) throw new Error('Auto Trade is already running.');
    const all = this.store.getAccounts();
    const accountIds = (options.accountIds || []).filter(id => all.some(a => a.id === id));
    const realMain = this.store.getAccountProfile?.()?.mainAccountId || null;
    const mainId = accountIds.includes(realMain) ? realMain : options.actingMainId;
    if (!mainId || !accountIds.includes(mainId)) throw new Error('Choose which selected account acts as main.');
    if (accountIds.length < 2) throw new Error('Select main and at least one side account.');
    const cfg = this._config(options);
    const password = options.roomPassword != null && options.roomPassword !== ''
      ? String(options.roomPassword)
      : (this.lastConfig?.roomPasswordEncrypted ? this.credentials.decryptSecret(this.lastConfig.roomPasswordEncrypted) : DEFAULTS.roomPassword);
    const config = {
      accountIds, mainId,
      sideToMainRoleIds: cfg.sideToMainRoleIds, mainToSideRoleIds: cfg.mainToSideRoleIds, maxPrice: cfg.maxPrice,
      roomDescription: String(cfg.roomDescription || DEFAULTS.roomDescription).slice(0, 50),
      roomPasswordEncrypted: this.credentials.encryptSecret(password),
      loopMode: ['off', 'count', 'infinite'].includes(cfg.loopMode) ? cfg.loopMode : 'off',
      loopCount: Math.max(1, Math.min(999, Math.floor(Number(cfg.loopCount) || 1))),
      baseAsSellable: Boolean(cfg.baseAsSellable),
      baseProjected: cfg.baseProjected !== false,
      benchDecisions: options.benchDecisions || {}
    };
    // The form remembers these for next time (not the account selection's one-off main).
    this.lastConfig = { ...config, benchDecisions: undefined, actingMainId: undefined };
    const accounts = {};
    for (const id of accountIds) {
      accounts[id] = { id, name: this._name(id), role: id === mainId ? 'main' : 'side', status: 'waiting', players: {}, bought: 0, spent: 0, converted: 0, tradesIn: 0, tradesOut: 0, tkPaid: 0, tkReceived: 0, listed: 0, openMs: 0, openedAt: null, visits: 0, funds: null, fundsStart: null, scout: null, benchApplied: false };
    }
    this.state = {
      id: `run-${this.now()}`, startedAt: new Date(this.now()).toISOString(), finishedAt: null,
      status: 'running', message: null, error: null, step: 'starting', stepParams: {}, activeId: null,
      config, accounts, cycle: 1, stage: 'main', sidesDone: [], sidesSkipped: [], currentSideId: null,
      excluded: {}, listingRequest: null, cardCounts: {}, nextAt: null
    };
    this._log('info', 'at2.started', { accounts: accountIds.length, main: this._name(mainId) }, `Auto Trade started · ${accountIds.length} accounts · main ${this._name(mainId)}`);
    this._save();
    this._launch();
    return this.snapshot();
  }

  continue() {
    if (this.controller) return this.snapshot();
    if (!this.state || ['done'].includes(this.state.status)) throw new Error('There is no Auto Trade to continue.');
    this.state.status = 'running';
    this.state.error = null;
    this.state.message = null;
    this._log('info', 'at2.continued', {}, 'Auto Trade continues from where it stopped');
    this._save();
    this._launch();
    return this.snapshot();
  }

  pause() {
    if (!this.controller || this.state.status !== 'running') return this.snapshot();
    let release;
    this.pauseGate = { promise: new Promise(r => { release = r; }), release };
    this.state.status = 'paused';
    this._log('warning', 'at2.paused', {}, 'Auto Trade paused');
    this._save();
    return this.snapshot();
  }

  resume() {
    if (this.state?.status !== 'paused') return this.snapshot();
    this.state.status = 'running';
    const gate = this.pauseGate;
    this.pauseGate = null;
    gate?.release();
    this._log('info', 'at2.resumed', {}, 'Auto Trade resumed');
    this._save();
    return this.snapshot();
  }

  async stop() {
    if (!this.controller) return this.snapshot();
    this.state.status = 'stopping';
    this._save();
    this.controller.abort();
    this.pauseGate?.release();
    this.listingWaiter?.(null);
    await this.done?.catch(() => {});
    return this.snapshot();
  }

  async reset() {
    if (this.controller) await this.stop();
    this.state = null;
    this._log('warning', 'at2.reset', {}, 'Auto Trade progress was reset');
    this._save();
    return this.snapshot();
  }

  // Clears the "players turned into cards" table (this run and the totals).
  resetCardCounts() {
    this.cardTotals = {};
    if (this.state) this.state.cardCounts = {};
    this._log('info', 'at2.cardsReset', {}, 'Star card counts were reset');
    this._save();
    return this.snapshot();
  }

  // Answer to the "side roster is full of players to keep" pop-up: items to list, or null to skip.
  respondListing(items) { const w = this.listingWaiter; this.listingWaiter = null; w?.(Array.isArray(items) ? items : null); return true; }

  async shutdown() { if (this.controller) { this.controller.abort(); await this.done?.catch(() => {}); } this._closeAll(); }

  _launch() {
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.done = this._run(signal).then(() => {
      this.state.status = 'done';
      this.state.finishedAt = new Date(this.now()).toISOString();
      this.state.step = 'done';
      this._log('success', 'at2.done', this._totals(), 'Auto Trade finished');
      this.onAttention?.('done');
    }, error => {
      if (error?.name === 'AbortError') {
        this.state.status = 'stopped';
        this.state.step = 'stopped';
        this._log('warning', 'at2.stopped', {}, 'Auto Trade stopped');
      } else {
        this.state.status = 'error';
        this.state.error = { message: error.message, code: error.code || null, params: error.params || {}, userFix: Boolean(error.userFix) };
        this._log('error', error.code || 'at2.failed', { ...(error.params || {}), error: error.message }, `Auto Trade stopped: ${error.message}`);
        this.onAttention?.('error', error.message);
      }
    }).finally(() => {
      this._closeAll();
      this.controller = null;
      this.pauseGate = null;
      this._save();
    });
  }

  _totals() {
    const a = Object.values(this.state.accounts);
    return { bought: a.reduce((n, x) => n + x.bought, 0), converted: a.reduce((n, x) => n + x.converted, 0), trades: a.reduce((n, x) => n + x.tradesOut, 0) };
  }

  async _gate(signal) {
    if (signal.aborted) throw abortError();
    while (this.pauseGate) { await this.pauseGate.promise; if (signal.aborted) throw abortError(); }
  }

  // ---------- connections ----------
  async _open(id, signal) {
    if (this.conns.has(id)) return this.conns.get(id);
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    this._step('opening', { name: account.name }, id);
    const conn = await TradeGameAccount.open({ account, sessions: this.sessions, createSocket: this.createSocket, signal });
    this.conns.set(id, conn);
    const acc = this._acc(id);
    acc.openedAt = new Date(this.now()).toISOString();
    acc.visits += 1;
    acc.funds = await conn.funds().catch(() => acc.funds);
    if (acc.fundsStart == null) acc.fundsStart = acc.funds;
    this._log('info', 'at2.opened', { name: account.name }, `${account.name} opened`, id);
    this._save();
    return conn;
  }

  _close(id) {
    const conn = this.conns.get(id);
    if (!conn) return;
    conn.close();
    this.conns.delete(id);
    const acc = this.state?.accounts?.[id];
    if (acc?.openedAt) { acc.openMs = (acc.openMs || 0) + (this.now() - Date.parse(acc.openedAt)); acc.openedAt = null; }
  }

  _closeAll() { for (const id of [...this.conns.keys()]) this._close(id); }

  // ---------- the run ----------
  async _run(signal) {
    const cfg = this.state.config;
    const maxCycles = cfg.loopMode === 'infinite' ? Infinity : cfg.loopMode === 'count' ? cfg.loopCount : 1;
    while (this.state.cycle <= maxCycles) {
      await this._gate(signal);
      if (this.state.stage === 'main') {
        if (this.state.cycle > 1) await this._waitScout(cfg.mainId, signal);
        await this._mainTurn(signal);
        this.state.stage = 'sides';
        this._save();
      }
      if (this.state.stage === 'sides') {
        for (;;) {
          await this._gate(signal);
          const next = this.state.currentSideId || await this._nextSide();
          if (!next) break;
          this.state.currentSideId = next;
          this._save();
          if (this.state.cycle > 1) await this._waitScout(next, signal);
          const result = await this._sideTurn(next, signal);
          this._acc(next).status = result?.skipped ? 'skipped' : 'done';
          (result?.skipped ? this.state.sidesSkipped : this.state.sidesDone).push(next);
          this.state.currentSideId = null;
          this._close(next);
          this._save();
        }
      }
      // Whatever came to main last is turned into cards before the cycle ends.
      if (this.conns.has(cfg.mainId)) await this._convertMain(signal);
      this._acc(cfg.mainId).status = 'done';
      this._close(cfg.mainId);
      await this._cardScan(signal);
      if (this.state.cycle >= maxCycles) break;
      this.state.cycle += 1;
      this.state.stage = 'main';
      this.state.sidesDone = [];
      this.state.sidesSkipped = [];
      for (const acc of Object.values(this.state.accounts)) acc.status = 'waiting';
      this._log('info', 'at2.cycle', { cycle: this.state.cycle, total: Number.isFinite(maxCycles) ? maxCycles : '∞' }, `Cycle ${this.state.cycle} starts`);
      this._save();
    }
  }

  // After all sides (each cycle in a loop): the Cards page scans main, so card counts
  // and stars are current. A failed scan is logged; it never stops Auto Trade.
  async _cardScan(signal) {
    if (!this.onCycleEnd) return;
    await this._gate(signal);
    this._step('cardScan', {}, this.state.config.mainId);
    try {
      await this.onCycleEnd();
      this._log('success', 'at2.cardScan', {}, 'Card scan of the main account finished');
    } catch (error) {
      this._log('warning', 'at2.cardScanFailed', { error: error.message }, 'Card scan failed: ' + error.message);
    }
    this._save();
  }

  // Loop mode: an account's turn comes when its Scout list refreshes.
  async _waitScout(id, signal) {
    const anonAt = this._acc(id).scout?.cooldownEnds;
    let until = Number(anonAt) || 0;
    if (!until) {
      const userId = this._userIdOf(id);
      if (userId) {
        const anon = await GameSocket.open({ createSocket: this.createSocket, signal });
        try { until = Number((await anon.ack('getFreeAgent', { userId }))?.cooldownEnds) || 0; } finally { anon.close(); }
      }
    }
    if (until > this.now()) {
      this.state.nextAt = new Date(until).toISOString();
      this._step('waitingScout', { name: this._name(id), at: this.state.nextAt }, id);
      this._save();
      while (this.now() < until + 2000) { await this._gate(signal); await sleep(Math.min(15000, until + 2000 - this.now()), signal); }
      this.state.nextAt = null;
    }
  }

  async _nextSide() {
    const s = this.state;
    const left = s.config.accountIds.filter(id => id !== s.config.mainId && !s.sidesDone.includes(id) && !s.sidesSkipped.includes(id));
    if (!left.length) return null;
    await this._refreshFunds(left);
    return R.sideOrder(left.map(id => ({ id, funds: this._acc(id).funds })))[0].id;
  }

  // TK of accounts that are not connected, read without logging in.
  async _refreshFunds(ids) {
    const todo = ids.filter(id => !this.conns.has(id) && this._userIdOf(id));
    if (!todo.length) return;
    let anon = null;
    try {
      anon = await GameSocket.open({ createSocket: this.createSocket });
      for (const id of todo) {
        const info = await anon.call('getUserBasicInfo', { userId: this._userIdOf(id) }, 'userBasicInfo', { timeoutMs: 8000 }).catch(() => null);
        if (Number.isFinite(Number(info?.funds))) this._acc(id).funds = Number(info.funds);
      }
    } catch {} finally { try { anon?.close(); } catch {} }
  }

  async _mainTurn(signal) {
    const id = this.state.config.mainId;
    this._acc(id).status = 'active';
    await this._open(id, signal);
    await this._applyBench(id, signal);
    this._log('info', 'at2.mainTurn', { name: this._name(id) }, `${this._name(id)} (main) scouting`, id);
    await this._scout(id, 'main', signal);
    await this._convertMain(signal);
  }

  async _sideTurn(id, signal) {
    this._acc(id).status = 'active';
    await this._open(id, signal);
    await this._open(this.state.config.mainId, signal);
    await this._applyBench(id, signal);
    this._log('info', 'at2.sideTurn', { name: this._name(id), funds: this._acc(id).funds }, `${this._name(id)} (side) · ${this._acc(id).funds} TK`, id);
    let r = await this._tradeWithMain(id, signal);
    if (r?.skipped) return r;
    const scout = await this._scout(id, 'side', signal);
    r = await this._tradeWithMain(id, signal);
    if (r?.skipped) return r;
    return scout?.skipped ? scout : {};
  }

  // Pre-existing bench players: list on the market / take part / leave them (user's choice).
  async _applyBench(id, signal) {
    const acc = this._acc(id);
    if (acc.benchApplied) return;
    const decisions = this.state.config.benchDecisions?.[id] || {};
    const conn = this.conns.get(id);
    const roster = R.rosterOf(await conn.roster());
    const cfg = this.state.config;
    for (const p of roster.bench) {
      const d = decisions[p.id];
      if (!d || d.action === 'none' || R.tradeBlock(p)) continue;
      if (d.action === 'list') {
        await this._gate(signal);
        const r = await conn.sell(p.id, d.price, d.currency);
        this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.listed' : 'at2.listFailed', { name: p.name, price: d.price, currency: d.currency, error: r?.message || '' }, `${p.name} listed · ${d.price} ${d.currency}`, id);
        if (r?.success) acc.listed += 1;
      } else if (d.action === 'trade') {
        const row = this._row(p, cfg, undefined, undefined, { status: 'existing' });
        if (row.dir) { row.status = this._statusFor(row.dir, acc.role); acc.players[p.id] = row; }
      }
    }
    acc.benchApplied = true;
    this._save();
  }

  _statusFor(dir, role) {
    if (role === 'main') return dir === 'main' ? 'toConvert' : 'toTrade';
    return dir === 'main' ? 'toTrade' : 'keep';
  }

  // The players this run may move on an account: ours, on the bench, tradable.
  _ours(id, roster, dir) {
    const rows = this._acc(id).players;
    return roster.bench.filter(p => rows[p.id] && rows[p.id].dir === dir && !['converted', 'listed', 'none'].includes(rows[p.id].status) && !R.tradeBlock(p));
  }

  async _scout(id, role, signal) {
    const conn = this.conns.get(id);
    const acc = this._acc(id);
    const cfg = this.state.config;
    const roleMap = this._roleMap();
    const roleNames = this._roleNames();
    for (let round = 0; round < 50; round++) {
      await this._gate(signal);
      let fa = await conn.freeAgents();
      if (fa?.cooldownEnds && fa.cooldownEnds <= this.now()) fa = await conn.freeAgents(); // 00:00 → the fresh list
      acc.scout = { attemptsLeft: fa?.attemptsLeft ?? null, cooldownEnds: fa?.cooldownEnds ?? null, at: new Date(this.now()).toISOString() };
      this.onScout?.(id, fa);
      let roster = R.rosterOf(await conn.roster());
      acc.funds = await conn.funds().catch(() => acc.funds);
      const candidates = (fa?.freeAgents || []).filter(a => !a.isSigned && !roster.ids.has(a.id) && R.classify(a, cfg, roleMap));
      this._step('scouting', { name: this._name(id), candidates: candidates.length, attempts: acc.scout.attemptsLeft }, id);
      this._save();
      for (const agent of candidates) {
        await this._gate(signal);
        if (roster.total >= R.ROSTER_MAX) {
          const room = await this._makeRoom(id, role, signal);
          if (!room) return { full: true };
          roster = R.rosterOf(await conn.roster());
          if (roster.total >= R.ROSTER_MAX) return { full: true };
        }
        const price = Number(agent.baseSalary) || 0;
        if (Number.isFinite(acc.funds) && acc.funds < price) {
          if (role === 'main') throw new UserFixError(`Main has ${acc.funds} TK, ${agent.name} costs ${price} TK.`, 'at2.mainFunds', { name: this._name(id), funds: acc.funds, need: price });
          this._log('warning', 'at2.sideFunds', { name: this._name(id), funds: acc.funds, need: price }, `${this._name(id)}: not enough TK, account skipped`, id);
          return { skipped: true };
        }
        this._step('signing', { name: this._name(id), player: agent.name, price }, id);
        const r = await conn.sign(agent.id);
        if (!r?.success) { this._log('warning', 'at2.signFailed', { player: agent.name, error: r?.message || r?.error || '' }, `${agent.name} could not be signed`, id); continue; }
        // The Scout page shows the bought player as signed ("Alındı", button off).
        fa = { ...fa, freeAgents: Array.isArray(r.freeAgents) ? r.freeAgents : (fa.freeAgents || []).map(a => a.id === agent.id ? { ...a, isSigned: true } : a) };
        this.onScout?.(id, fa);
        // Lv30+ accounts can sign at a 5% discount: the real salary is on the roster.
        const signedAs = (await conn.roster().catch(() => null))?.players?.bench?.find(p => p.id === agent.id);
        const salary = Number(signedAs?.signedSalary) || price;
        const row = this._row({ ...agent, ...(signedAs || {}), signedSalary: salary }, cfg, roleMap, roleNames);
        row.status = this._statusFor(row.dir, role);
        row.discounted = salary < price;
        acc.players[agent.id] = row;
        if (cfg.baseAsSellable && row.dir === 'side' && R.classify(agent, { ...cfg, baseAsSellable: false }, roleMap) === 'main') {
          this._log('info', 'at2.baseSellable', { player: agent.name, salary, base: signedAs?.newBaseSalary ?? agent.newBaseSalary }, `${agent.name} signed at ${salary} (Base) → treated as Satılabilir`, id);
        }
        acc.bought += 1;
        acc.spent += price; // signing costs the price; the discount is on the salary
        acc.funds = Number.isFinite(acc.funds) ? acc.funds - price : acc.funds;
        roster.total += 1;
        roster.ids.add(agent.id);
        this._log('success', 'at2.signed', { player: agent.name, price, dir: row.dir }, `${agent.name} signed · ${price} TK`, id);
        this._save();
        await sleep(this.timing.stepMs, signal);
      }
      // No more to buy in this list: call a new one while free attempts are left.
      if (!(fa?.attemptsLeft > 0)) return { exhausted: true };
      if (roster.total >= R.ROSTER_MAX && !(await this._makeRoom(id, role, signal))) return { full: true };
      this._step('callback', { name: this._name(id), attempts: fa.attemptsLeft }, id);
      const cb = await conn.callback();
      if (!cb?.success) return { exhausted: true };
      this.onScout?.(id, { ...fa, freeAgents: cb.freeAgents || [], attemptsLeft: Math.max(0, (fa.attemptsLeft || 1) - 1) });
      this._log('info', 'at2.callback', { left: (fa.attemptsLeft || 1) - 1 }, 'Scout called back', id);
      await sleep(this.timing.stepMs, signal);
    }
    return { exhausted: true };
  }

  // A full roster: main converts or unloads to sides; a side gives to main or lists.
  async _makeRoom(id, role, signal) {
    if (role === 'main') {
      if (await this._convertMain(signal)) return true;
      return this._unloadMain(signal);
    }
    const r = await this._tradeWithMain(id, signal);
    if (r?.skipped) return false;
    const roster = R.rosterOf(await this.conns.get(id).roster());
    if (roster.total < R.ROSTER_MAX) return true;
    return this._askListing(id, roster, signal);
  }

  // Main's bench players headed for cards → Make. Returns true when something was converted.
  async _convertMain(signal) {
    const id = this.state.config.mainId;
    const conn = this.conns.get(id) || await this._open(id, signal);
    await this._gate(signal);
    const roster = R.rosterOf(await conn.roster());
    const list = this._ours(id, roster, 'main');
    if (!list.length) return false;
    const acc = this._acc(id);
    for (const p of list) acc.players[p.id].status = 'converting';
    this._step('converting', { count: list.length }, id);
    this._save();
    const r = await conn.makeCards(list.map(p => p.id));
    if (!r?.success) {
      for (const p of list) acc.players[p.id].status = 'toConvert';
      throw new UserFixError(`Make failed: ${r?.message || r?.error || 'no answer'}`, 'at2.makeFailed', { error: r?.message || r?.error || '' });
    }
    for (const p of list) {
      acc.players[p.id].status = 'converted';
      acc.players[p.id].convertedAt = new Date(this.now()).toISOString();
      const name = acc.players[p.id].name;
      this.state.cardCounts[p.id] = { name, count: (this.state.cardCounts[p.id]?.count || 0) + 1 };
      this.cardTotals[p.id] = { name, count: (this.cardTotals[p.id]?.count || 0) + 1 };
    }
    acc.converted += list.length;
    this._log('success', 'at2.converted', { count: list.length, names: list.map(p => p.name).join(', ') }, `${list.length} player(s) turned into star cards`, id);
    this._save();
    await sleep(this.timing.stepMs, signal);
    return true;
  }

  // Main is full of players for sides: hand them to the highest-TK sides (no scouting
  // there; their own side→main bench players come back in the same trade).
  async _unloadMain(signal) {
    const s = this.state;
    const mainId = s.config.mainId;
    const sides = s.config.accountIds.filter(id => id !== mainId && !s.sidesSkipped.includes(id));
    await this._refreshFunds(sides);
    for (const side of R.sideOrder(sides.map(id => ({ id, funds: this._acc(id).funds }))).map(x => x.id)) {
      await this._gate(signal);
      const wasOpen = this.conns.has(side);
      await this._open(side, signal);
      this._log('info', 'at2.unload', { name: this._name(side) }, `Main is full · giving players to ${this._name(side)}`, side);
      await this._tradeWithMain(side, signal, { unload: true });
      if (!wasOpen && side !== s.currentSideId) this._close(side);
      const roster = R.rosterOf(await this.conns.get(mainId).roster());
      if (roster.total < R.ROSTER_MAX) return true;
    }
    throw new UserFixError('Main is full and no side could take its players.', 'at2.mainFull', { name: this._name(mainId) });
  }

  // Trades between main (guest) and one side (host) until nothing more can move.
  async _tradeWithMain(sideId, signal, { unload = false } = {}) {
    const mainId = this.state.config.mainId;
    const main = this.conns.get(mainId) || await this._open(mainId, signal);
    const side = this.conns.get(sideId) || await this._open(sideId, signal);
    let dupRetry = false;
    let failRetry = 0;
    for (let round = 0; round < MAX_TRADE_ROUNDS; round++) {
      await this._gate(signal);
      let mainRoster = R.rosterOf(await main.roster());
      const sideRoster = R.rosterOf(await side.roster());
      const excluded = new Set(this.state.excluded[sideId] || []);
      const mainGive = this._ours(mainId, mainRoster, 'side').filter(p => !excluded.has(p.id));
      const sideGive = this._ours(sideId, sideRoster, 'main');
      if (!mainGive.length && !sideGive.length) return {};
      // Room on main for what comes in: convert first.
      if (sideGive.length && mainRoster.total - mainGive.length + 1 > R.ROSTER_MAX && await this._convertMain(signal)) mainRoster = R.rosterOf(await main.roster());
      const mainFunds = await main.funds().catch(() => this._acc(mainId).funds);
      const sideFunds = await side.funds().catch(() => this._acc(sideId).funds);
      this._acc(mainId).funds = mainFunds;
      this._acc(sideId).funds = sideFunds;
      const plan = R.planTrade({ mainRoster, sideRoster, mainGive, sideGive, mainFunds, sideFunds });
      // main→side duplicates go to the next side.
      if (plan.dupToSide.length) {
        this.state.excluded[sideId] = [...excluded, ...plan.dupToSide.map(p => p.id)];
        this._log('warning', 'at2.dupNextSide', { names: plan.dupToSide.map(p => p.name).join(', '), side: this._name(sideId) }, `${plan.dupToSide.map(p => p.name).join(', ')} already on ${this._name(sideId)} · kept for the next side`, sideId);
      }
      // side→main duplicates: Make on main once, then it is for the user to fix.
      if (plan.dupToMain.length) {
        if (!dupRetry) { dupRetry = true; await this._convertMain(signal); continue; }
        throw new UserFixError(`${plan.dupToMain.map(p => p.name).join(', ')} is already on main.`, 'at2.dupOnMain', { names: plan.dupToMain.map(p => p.name).join(', ') });
      }
      if (plan.empty) return {};
      if (!plan.mainCanPay) throw new UserFixError(`Main needs ${plan.tk} TK for this trade, it has ${mainFunds}.`, 'at2.mainFunds', { name: this._name(mainId), funds: mainFunds, need: plan.tk });
      if (!plan.sideCanPay) {
        this._log('warning', 'at2.sideFunds', { name: this._name(sideId), funds: sideFunds, need: -plan.tk }, `${this._name(sideId)}: not enough TK for the trade, account skipped`, sideId);
        return { skipped: true };
      }
      const result = await this._executeTrade(sideId, plan, signal);
      if (result.success) {
        this._afterTrade(sideId, plan);
        failRetry = 0;
        if (plan.sideGives.length) await this._convertMain(signal);
        continue;
      }
      const kind = R.tradeFailure(result.message);
      this._log('warning', 'at2.tradeFailed', { side: this._name(sideId), error: result.message }, `Trade with ${this._name(sideId)} failed: ${result.message}`, sideId);
      if (kind === 'dupToGuest' && !dupRetry) { dupRetry = true; await this._convertMain(signal); continue; }
      if (failRetry++ < 1 && ['equipped', 'rosterFull', 'other'].includes(kind)) continue;
      throw new UserFixError(`Trade with ${this._name(sideId)} failed: ${result.message}`, 'at2.tradeStuck', { side: this._name(sideId), error: result.message });
    }
    return {};
  }

  async _executeTrade(sideId, plan, signal) {
    const s = this.state;
    const mainId = s.config.mainId;
    const main = this.conns.get(mainId);
    const side = this.conns.get(sideId);
    const password = this.credentials.decryptSecret(s.config.roomPasswordEncrypted);
    for (const p of plan.mainGives) this._acc(mainId).players[p.id].status = 'trading';
    for (const p of plan.sideGives) this._acc(sideId).players[p.id].status = 'trading';
    this._step('trading', { side: this._name(sideId), give: plan.mainGives.length, take: plan.sideGives.length, tk: plan.tk }, sideId);
    this._save();
    let roomId = null;
    try {
      roomId = await side.createRoom(s.config.roomDescription, password);
      const sideJoined = side.expect('joinedRoomData', d => d?.roomId === roomId);
      const room = await main.joinRoom(roomId, password);
      await sideJoined.catch(() => null);
      const pick = (list, wanted) => wanted.map(p => (list || []).find(x => x.id === p.id));
      const sideSel = pick(room.hostPlayers, plan.sideGives);
      const mainSel = pick(room.guestPlayers, plan.mainGives);
      if ([...sideSel, ...mainSel].some(x => !x)) return { success: false, message: 'A selected player is not offered in the trade room.' };
      // Every selection resets both acceptances. An empty selection is not sent (the
      // room starts empty): sending main's empty list after the side had already
      // matched let it reset the side's acceptance later, so "accepted by both" never
      // came (Trophy7 / Trophy5, 2026-10-22). Each selection waits for its own update.
      if (sideSel.length) {
        const upd = main.expect('tradeSelectionUpdate', d => d?.roomId === roomId && sameIds(d.hostSelectedPlayers, sideSel));
        side.select(roomId, sideSel);
        await upd;
      }
      if (mainSel.length) {
        const upd = main.expect('tradeSelectionUpdate', d => d?.roomId === roomId && sameIds(d.hostSelectedPlayers, sideSel) && sameIds(d.guestSelectedPlayers, mainSel));
        main.select(roomId, mainSel);
        await upd;
      }
      await sleep(300, signal);
      // Accept from both sides; if the game did not register both, accept again.
      for (let attempt = 1; ; attempt++) {
        const both = main.expect('acceptTradeUpdate', d => d?.hostAccepted && d?.guestAccepted, ACCEPT_WAIT_MS);
        side.accept(roomId);
        await sleep(250, signal);
        main.accept(roomId);
        try { await both; break; } catch (error) { if (attempt >= ACCEPT_TRIES) throw error; }
      }
      const resultP = main.expect('tradeResult', () => true);
      main.confirm(roomId, sideSel, mainSel);
      const result = await resultP;
      return { success: Boolean(result?.success), message: result?.message || '' };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return { success: false, message: error.message };
    } finally {
      for (const p of plan.mainGives) if (this._acc(mainId).players[p.id]?.status === 'trading') this._acc(mainId).players[p.id].status = 'toTrade';
      for (const p of plan.sideGives) if (this._acc(sideId).players[p.id]?.status === 'trading') this._acc(sideId).players[p.id].status = 'toTrade';
      if (roomId) side.cancelRoom(roomId);
      main.leave();
    }
  }

  _afterTrade(sideId, plan) {
    const mainId = this.state.config.mainId;
    const main = this._acc(mainId);
    const side = this._acc(sideId);
    for (const p of plan.mainGives) {
      const row = main.players[p.id];
      delete main.players[p.id];
      side.players[p.id] = { ...row, status: 'keep', from: main.name };
    }
    for (const p of plan.sideGives) {
      const row = side.players[p.id];
      delete side.players[p.id];
      main.players[p.id] = { ...row, status: 'toConvert', from: side.name };
    }
    side.tradesOut += plan.sideGives.length;
    side.tradesIn += plan.mainGives.length;
    main.tradesOut += plan.mainGives.length;
    main.tradesIn += plan.sideGives.length;
    if (plan.tk > 0) { main.tkPaid += plan.tk; side.tkReceived += plan.tk; }
    if (plan.tk < 0) { side.tkPaid += -plan.tk; main.tkReceived += -plan.tk; }
    this._log('success', 'at2.traded', { side: side.name, give: plan.mainGives.length, take: plan.sideGives.length, tk: plan.tk }, `Trade with ${side.name}: main gave ${plan.mainGives.length}, got ${plan.sideGives.length} · ${plan.tk} TK`, sideId);
    this._save();
  }

  // A side full of players it keeps: ask the user which to list on the market.
  async _askListing(id, roster, signal) {
    const acc = this._acc(id);
    const players = this._ours(id, roster, 'side').map(p => {
      const row = acc.players[p.id];
      const kind = row.roleIds?.some(r => (this.state.config.mainToSideRoleIds || []).includes(r) && r !== 'sellable') ? 'stock' : 'sellable';
      return { id: p.id, name: row.name, salary: row.salary, value: row.price, base: row.base ?? (Number(p.newBaseSalary) || null), roles: row.roles, ...LIST_DEFAULTS[kind] };
    });
    if (!players.length) return false;
    this.state.listingRequest = { accountId: id, name: acc.name, players };
    const before = this.state.status;
    this.state.status = 'awaitingListing';
    this._save();
    this.onAttention?.('listing', acc.name);
    const items = await new Promise(resolve => { this.listingWaiter = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
    this.state.listingRequest = null;
    this.state.status = before === 'awaitingListing' ? 'running' : 'running';
    this._save();
    if (signal.aborted) throw abortError();
    if (!items?.length) return false;
    await this._list(id, items, signal);
    return R.rosterOf(await this.conns.get(id).roster()).total < R.ROSTER_MAX;
  }

  async _list(id, items, signal) {
    const conn = this.conns.get(id);
    const acc = this._acc(id);
    for (const it of items) {
      await this._gate(signal);
      const r = await conn.sell(it.id, it.price, it.currency);
      const row = acc.players[it.id];
      if (r?.success) { if (row) row.status = 'listed'; acc.listed += 1; }
      this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.listed' : 'at2.listFailed', { name: row?.name || it.id, price: it.price, currency: it.currency, error: r?.message || '' }, `${row?.name || it.id} ${r?.success ? 'listed' : 'not listed'} · ${it.price} ${it.currency}`, id);
      this._save();
    }
  }

  // After a side is finished (also while the run goes on): list its kept players.
  async listPlayers(accountId, items) {
    if (!this.state?.accounts?.[accountId]) throw new Error('Unknown account.');
    const signal = this.controller?.signal || new AbortController().signal;
    const temp = !this.conns.has(accountId);
    const acc = this._acc(accountId);
    const before = acc.listed;
    // Outside a run (after it finished) the status line goes back to where it was, so
    // "opening <side>" never stays on screen next to "Completed".
    const prev = this.controller ? null : { step: this.state.step, stepParams: this.state.stepParams, activeId: this.state.activeId };
    try {
      if (temp) await this._open(accountId, signal);
      this._step('listing', { name: this._name(accountId), count: items.length }, accountId);
      await this._list(accountId, items, signal);
    } finally {
      if (temp) this._close(accountId);
      if (prev) Object.assign(this.state, prev);
      this._log(acc.listed - before === items.length ? 'success' : 'warning', 'at2.listDone', { name: this._name(accountId), listed: acc.listed - before, total: items.length }, `Market listing finished · ${this._name(accountId)} · ${acc.listed - before}/${items.length}`, accountId);
      this._save();
    }
    return this.snapshot();
  }
}

function sameIds(a, b) {
  const x = (a || []).map(p => p.id).sort().join(',');
  const y = (b || []).map(p => p.id).sort().join(',');
  return x === y;
}

module.exports = { AutoTradeEngine, UserFixError, DEFAULTS, LIST_DEFAULTS };
