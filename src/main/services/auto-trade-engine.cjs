const { GameSocket } = require('./game-socket.cjs');
const { isNetError } = require('./game-health.cjs');
const { TradeGameAccount, sleep, abortError } = require('./trade-game-client.cjs');
const { OwnedSwap } = require('./owned-swap.cjs');
const R = require('./trade-rules.cjs');
const { AsyncLocalStorage } = require('node:async_hooks');

const TRADE_MIN_LEVEL = 10; // the game opens trading at level 10

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
const SPENDER_PRICE = 999999; // a Harcayıcı lists its overflow at this price by default (TIX)

// Sides scout at the same time (user 2026-11-07: 141 accounts one by one = 4+ hours a cycle);
// trades with main stay one at a time.
const PARALLEL_DEFAULT = 3;
const PARALLEL_MAX = 6;
// Below this main cannot take even one cheap player: the run stops (user 2026-11-07: sides kept
// buying for an hour while main had 9 TK; the players waited on them, over the salary cap).
const MAIN_TK_FLOOR = 50;
// A Hazırlık (bench decisions only) is remembered this long for the next start.
const PREP_VALID_MS = 60 * 60 * 1000;
// Rough durations of the wrap-up steps (live 2026-11-07), for the countdown.
const EST = { open: 6000, list: 2500, fire: 1500, trade: 6000, convert: 3000 };

// One at a time; the same chain may take it again (nested calls run straight through).
class Lock {
  constructor() { this.tail = Promise.resolve(); this.als = new AsyncLocalStorage(); }
  async run(fn) {
    if (this.als.getStore()) return fn();
    const prev = this.tail;
    let release;
    this.tail = new Promise(r => { release = r; });
    try { await prev; return await this.als.run(true, fn); } finally { release(); }
  }
}

const ACCEPT_WAIT_MS = 7000;
const ACCEPT_TRIES = 3;

class UserFixError extends Error { constructor(message, code, params) { super(message); this.userFix = true; this.code = code; this.params = params || {}; } }

class AutoTradeEngine {
  constructor({ store, credentials, activity, sessions, accountProfile, onChanged, onAttention, onScout, onCycleEnd, createSocket, gameHealth = null, friendNet = null, pauseAccount = null, onSpenderListed = null, now = () => Date.now(), timing = {} }) {
    this.pauseAccount = pauseAccount;       // (accountId, task) → resume(): Auto Play etc. step aside for a Harcayıcı
    this.onSpenderListed = onSpenderListed; // ({accountId, player, price, currency}) → the editable price table
    this.resumers = new Map();
    this._spenderTodo = new Set(); // spenders that got players: they list them at the end of the turn
    this._stokHolders = new Set(); // Lv30+ non-Harcayıcı accounts holding a Stok they signed: they trade it on
    this.friendNet = friendNet; // friends of our accounts: boards, signing for another account, the spender network
    this.gameHealth = gameHealth; // shared "is the game reachable?"
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
    this.roleWaiter = null;
    // main's connection, the spenders and the user's pop-ups are used one at a time by the
    // parallel sides; the wrap-up after a stop / pause runs past the pause gate
    this._mainLock = new Lock();
    this._spLock = new Lock();
    this._askLock = new Lock();
    this._claimLock = new Lock();
    this._bypass = new AsyncLocalStorage();
    this._opening = new Map();
    for (const m of ['_tradeWithMain', '_convertMain', '_unloadMain', '_mainToSpenders']) { const f = this[m].bind(this); this[m] = (...a) => this._mainLock.run(() => f(...a)); }
    for (const m of ['_spenderBuy', '_spenderRoom', '_flushSpenders', '_sideToSpender', '_helperSign', '_tradePair']) { const f = this[m].bind(this); this[m] = (...a) => this._spLock.run(() => f(...a)); }
    for (const m of ['_askListing', '_askRole']) { const f = this[m].bind(this); this[m] = (...a) => this._askLock.run(() => f(...a)); }
    const saved = this.store.getAutoTrade2();
    this.prep = saved?.prep || null;
    if (this.prep?.status === 'running') this.prep.status = 'stopped';
    this.state = saved?.run || null;
    this.cardTotals = saved?.cardTotals || {};
    this.lastConfig = saved?.lastConfig || null;
    this.pricing = this._normPricing(saved?.pricing, this.lastConfig);
    // An app restart in the middle of a run leaves it continuable, never "running".
    if (this.state && ['running', 'paused', 'awaitingListing', 'awaitingRole', 'stopping'].includes(this.state.status)) {
      this.state.status = 'stopped';
      this.state.message = 'interrupted';
    }
    if (this.state?.status === 'done') { this.state.step = 'done'; this.state.stepParams = {}; }
  }

  // ---------- state ----------
  _save() {
    this.store.saveAutoTrade2({ version: 2, run: this.state, cardTotals: this.cardTotals, lastConfig: this.lastConfig, pricing: this.pricing, prep: this.prep });
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
      // the time Auto Trade really worked (stops and pauses left out)
      run.activeSeconds = Math.round(((run.activeMs || 0) + (run.runningSince ? now - Date.parse(run.runningSince) : 0)) / 1000);
      const total = run.config.accountIds.length - 1;
      const finished = (run.sidesDone || []).length + (run.sidesSkipped || []).length;
      const active = (run.activeSides || []).length;
      const avg = run.turns ? run.turnMs / run.turns : null;
      const par = Math.max(1, Math.min(PARALLEL_MAX, Number(run.config.parallelSides) || PARALLEL_DEFAULT));
      run.cycleInfo = { total, finished, active, parallel: par, avgTurnSeconds: avg ? Math.round(avg / 1000) : null,
        etaSeconds: run.stage === 'sides' && avg ? Math.round((Math.max(0, total - finished - active) * avg / par + (active ? avg / 2 : 0)) / 1000) : null };
    }
    const last = this.lastConfig ? { ...this.lastConfig } : null;
    if (last) {
      // The form shows the saved room password (masked, with a show button).
      last.hasPassword = Boolean(last.roomPasswordEncrypted);
      try { last.roomPassword = last.roomPasswordEncrypted ? this.credentials.decryptSecret(last.roomPasswordEncrypted) : null; } catch { last.roomPassword = null; }
      delete last.roomPasswordEncrypted;
    }
    const prep = this.prep ? { status: this.prep.status, at: this.prep.at, startedAt: this.prep.startedAt, total: this.prep.total, done: this.prep.done, error: this.prep.error || null, fresh: Boolean(this._freshPrep()), accountIds: Object.keys(this.prep.accounts || {}) } : null;
    return { run, prep, friendSetup: this.friendNet?.snapshotSetup?.() || null, cardTotals: JSON.parse(JSON.stringify(this.cardTotals)), lastConfig: last, pricing: JSON.parse(JSON.stringify(this.pricing)), defaults: { ...DEFAULTS, roomPassword: undefined }, listDefaults: LIST_DEFAULTS };
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

  // The account role (Accounts page) of a side: "2. Main", its own role, or Side.
  _accountRoleId(id) {
    if (this.store.getAccountProfile?.()?.secondMainId === id) return 'main2';
    const role = this.store.getAccounts().find(a => a.id === id)?.role;
    const defs = this.store.getSettings?.()?.accountRoleDefs;
    return role && (!Array.isArray(defs) || defs.some(d => d.id === role)) ? role : 'side';
  }
  // What a side may sign, by its account role (user 2026-10-31); main has no limits.
  _ruleFor(id) {
    if (!this.state || id === this.state.config.mainId) return null;
    return this.state.config.roleRules?.[this._accountRoleId(id)] || null;
  }

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

  // Trading opens at level 10 in the game: lower accounts never join a run (user 2026-10-30).
  // An account whose level is not known yet is let through.
  _tradeLocked(id) { const lv = Number(this.store.getAccountProfile?.()?.accounts?.[id]?.level); return Number.isFinite(lv) && lv > 0 && lv < TRADE_MIN_LEVEL; }

  async preflight({ accountIds, config = {} } = {}) {
    const accounts = this.store.getAccounts().filter(a => accountIds.includes(a.id) && !this._tradeLocked(a.id));
    const roleMap = this._roleMap();
    const roleNames = this._roleNames();
    const cfg = this._config(config);
    const out = [];
    const prep = this._freshPrep();
    let anon = null;
    try {
      anon = await GameSocket.open({ createSocket: this.createSocket });
      for (const account of accounts) {
        // prepared a moment ago (Hazırlık): its bench decisions are done, nothing is asked again
        if (prep?.accounts?.[account.id]) { out.push({ id: account.id, name: account.name, prepared: prep.at, funds: null, total: null, starters: null, bench: [] }); continue; }
        let userId = this._userIdOf(account.id);
        if (!userId) userId = (await this.sessions.get(account, { owner: 'auto-trade' })).userId;
        const roster = R.rosterOf(await anon.ack('getTeamOptimized', { userId }));
        const info = await anon.call('getUserBasicInfo', { userId }, 'userBasicInfo').catch(() => null);
        out.push({
          id: account.id, name: account.name, userId, funds: Number(info?.funds) || null,
          total: roster.total, starters: roster.starters.length,
          bench: roster.bench.map(p => this._row(p, cfg, roleMap, roleNames, { status: 'existing', block: R.tradeBlock(p), fireOnly: R.fireOnly(p) }))
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

  // ---------- Otomatik Fiyatlandırma (user 2026-11-06) ----------
  // What a Harcayıcı lists each Satılabilir / Stok player at: a default per kind, and per player
  // its own price, a price for when it was signed at the 5% discount, and "Lv30+ only".
  // Saved apart from the run, so it can change while Auto Trade runs (used at listing time).
  _normPricing(raw, last = null) {
    const cur = c => (c === 'APK' ? 'APK' : 'TIX');
    const pos = v => (Number(v) >= 1 ? Math.floor(Number(v)) : null);
    const def = (d, fb) => ({ price: pos(d?.price) || fb.price, currency: d?.currency ? cur(d.currency) : fb.currency });
    const players = {};
    for (const [id, p] of Object.entries(raw?.players || {})) {
      const row = {};
      if (pos(p?.price)) { row.price = pos(p.price); row.currency = cur(p.currency); }
      if (pos(p?.discPrice)) { row.discPrice = pos(p.discPrice); row.discCurrency = cur(p.discCurrency || p.currency); }
      if (p?.lv30) row.lv30 = true;
      if (p?.fireNoDisc) row.fireNoDisc = true; // not signed 5% off → fired instead of listed (user 2026-11-06)
      if (Object.keys(row).length) players[id] = row;
    }
    return {
      defaults: {
        sellable: def(raw?.defaults?.sellable, { price: 20, currency: 'APK' }),
        stok: def(raw?.defaults?.stok, { price: pos(last?.spenderStockPrice) || 99999, currency: last?.spenderStockCurrency ? cur(last.spenderStockCurrency) : 'TIX' })
      },
      players
    };
  }

  savePricing(raw = {}) {
    this.pricing = this._normPricing({ defaults: { ...this.pricing.defaults, ...(raw.defaults || {}) }, players: raw.players ?? this.pricing.players }, this.lastConfig);
    this._save();
    return JSON.parse(JSON.stringify(this.pricing));
  }

  // Price a Harcayıcı lists player p at. "Discounted": signed at the 5% discount (kept on the
  // row when we signed it; otherwise its locked salary is clearly under its value).
  _listPrice(p, accId) {
    const kind = this._isStok(p) ? 'stok' : 'sellable';
    const own = this.pricing.players[p.id] || {};
    const row = this.state?.accounts?.[accId]?.players?.[p.id];
    const salary = R.salaryOf(p), value = Number(p.baseSalary) || 0;
    const discounted = row?.discounted ?? (salary > 0 && value > 0 && salary <= Math.floor(value * 0.96));
    if (own.fireNoDisc && !discounted) return { fire: true, kind, discounted: false };
    if (discounted && own.discPrice) return { price: own.discPrice, currency: own.discCurrency || own.currency || this.pricing.defaults[kind].currency, kind, discounted: true };
    if (own.price) return { price: own.price, currency: own.currency, kind, discounted: Boolean(discounted) };
    return { price: this.pricing.defaults[kind].price, currency: this.pricing.defaults[kind].currency, kind, discounted: Boolean(discounted), isDefault: true };
  }

  // Stok, and Satılabilir players marked "Lv30+ only": signed only by Lv30+ accounts.
  _needsLv30(agent, roleMap = this._roleMap()) { return this._isStok(agent, roleMap) || Boolean(this.pricing.players[agent.id]?.lv30); }

  // The form's choices are saved as they change (user 2026-10-31: the page forgot the
  // role rules and account choices when the run was not started), not only on Start.
  saveDraft(raw = {}) {
    const last = { ...(this.lastConfig || {}) };
    const ids = v => Array.isArray(v) ? v.filter(s => typeof s === 'string') : undefined;
    if (ids(raw.accountIds)) last.accountIds = ids(raw.accountIds);
    if (ids(raw.sideToMainRoleIds)) last.sideToMainRoleIds = ids(raw.sideToMainRoleIds);
    if (ids(raw.mainToSideRoleIds)) last.mainToSideRoleIds = ids(raw.mainToSideRoleIds);
    const price = Math.floor(Number(raw.maxPrice));
    if (raw.maxPrice !== '' && raw.maxPrice != null && Number.isFinite(price)) last.maxPrice = Math.min(2500, Math.max(0, price));
    if (raw.roleRules && typeof raw.roleRules === 'object') last.roleRules = R.normalizeRoleRules(raw.roleRules);
    if (typeof raw.roomDescription === 'string') last.roomDescription = raw.roomDescription.slice(0, 50);
    if (typeof raw.roomPassword === 'string' && raw.roomPassword) last.roomPasswordEncrypted = this.credentials.encryptSecret(raw.roomPassword);
    if (['off', 'count', 'infinite'].includes(raw.loopMode)) last.loopMode = raw.loopMode;
    if (raw.loopCount != null && Number(raw.loopCount) >= 1) last.loopCount = Math.min(999, Math.floor(Number(raw.loopCount)));
    if (raw.baseAsSellable != null) last.baseAsSellable = Boolean(raw.baseAsSellable);
    if (raw.baseProjected != null) last.baseProjected = raw.baseProjected !== false;
    if (raw.friendBoards != null) last.friendBoards = raw.friendBoards !== false;
    for (const k of ['spenderSellPrice', 'spenderStockPrice']) if (Number(raw[k]) >= 1) last[k] = Math.floor(Number(raw[k]));
    for (const k of ['spenderSellCurrency', 'spenderStockCurrency']) if (['TIX', 'APK'].includes(raw[k])) last[k] = raw[k];
    if (Number(raw.spendersPerSide) >= 1) last.spendersPerSide = Math.min(20, Math.floor(Number(raw.spendersPerSide)));
    if (raw.spenderMinTk != null) last.spenderMinTk = Math.max(0, Math.floor(Number(raw.spenderMinTk) || 0));
    this.lastConfig = last;
    this._save();
    return true;
  }

  async start(options = {}) {
    if (this.controller) throw new Error('Auto Trade is already running.');
    this.roleAnswers = new Map();
    const all = this.store.getAccounts();
    const locked = (options.accountIds || []).filter(id => all.some(a => a.id === id) && this._tradeLocked(id));
    for (const id of locked) this._log('warning', 'at2.lowLevel', { name: this._name(id), min: TRADE_MIN_LEVEL }, `${this._name(id)} is below level ${TRADE_MIN_LEVEL} (trading is closed) · left out`, id);
    const accountIds = (options.accountIds || []).filter(id => all.some(a => a.id === id) && !locked.includes(id));
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
      roleRules: R.normalizeRoleRules(cfg.roleRules),
      roomDescription: String(cfg.roomDescription || DEFAULTS.roomDescription).slice(0, 50),
      roomPasswordEncrypted: this.credentials.encryptSecret(password),
      loopMode: ['off', 'count', 'infinite'].includes(cfg.loopMode) ? cfg.loopMode : 'off',
      loopCount: Math.max(1, Math.min(999, Math.floor(Number(cfg.loopCount) || 1))),
      baseAsSellable: Boolean(cfg.baseAsSellable),
      baseProjected: cfg.baseProjected !== false,
      friendBoards: cfg.friendBoards !== false,
      // what a Harcayıcı lists to make room: Satılabilir and Stok each at their own default
      spenderSellPrice: Math.max(1, Math.floor(Number(cfg.spenderSellPrice) || Number(cfg.spenderPrice) || SPENDER_PRICE)),
      spenderSellCurrency: (cfg.spenderSellCurrency || cfg.spenderCurrency) === 'APK' ? 'APK' : 'TIX',
      spenderStockPrice: Math.max(1, Math.floor(Number(cfg.spenderStockPrice) || Number(cfg.spenderPrice) || SPENDER_PRICE)),
      spenderStockCurrency: (cfg.spenderStockCurrency || cfg.spenderCurrency) === 'APK' ? 'APK' : 'TIX',
      spenderMinTk: Math.max(0, Math.floor(Number(cfg.spenderMinTk) || 0)),
      parallelSides: Math.max(1, Math.min(PARALLEL_MAX, Math.floor(Number(cfg.parallelSides) || PARALLEL_DEFAULT))),
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
      config, accounts, cycle: 1, stage: 'prep', sidesDone: [], sidesSkipped: [], currentSideId: null, activeSides: [],
      excluded: {}, listingRequest: null, cardCounts: {}, nextAt: null, activeMs: 0, runningSince: null, turnMs: 0, turns: 0, wrapUp: null
    };
    // rows of a fresh Hazırlık are taken over by the prep stage
    const prep = this._freshPrep();
    if (prep) { this.state.prepFrom = { at: prep.at, accounts: prep.accounts }; this.prep.usedBy = this.state.id; }
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
    this._clockOff();
    this._log('warning', 'at2.paused', {}, 'Auto Trade paused');
    this._save();
    // paused: what the spenders hold goes to the market; the cheap players stay (user 2026-11-07)
    this._wrapUp('pause').catch(() => {});
    return this.snapshot();
  }

  resume() {
    if (this.state?.status !== 'paused') return this.snapshot();
    this.state.status = 'running';
    this._clockOn();
    const gate = this.pauseGate;
    this.pauseGate = null;
    gate?.release();
    this._log('info', 'at2.resumed', {}, 'Auto Trade resumed');
    this._save();
    return this.snapshot();
  }

  // `hard: false`: another task asks (a listing by hand…) — the spenders' last listing is never
  // cut by it (user 2026-11-07: a second stop from a hand listing cut it after 2 s).
  async stop({ hard = true } = {}) {
    if (!this.controller) return this.snapshot();
    // a second Stop (the user's) while the spenders list their players: stop that too
    if (hard && this.state.status === 'stopping' && this._leftoverCtrl) this._leftoverCtrl.abort();
    this.state.status = 'stopping';
    this._save();
    this.controller.abort();
    this.pauseGate?.release();
    this.listingWaiter?.(null);
    this.roleWaiter?.(null);
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

  // Answer to "this player has roles both ways": 'main' (to cards), 'side' (Satılabilir) or null (leave it).
  respondRole(dir) { const w = this.roleWaiter; this.roleWaiter = null; w?.(['main', 'side'].includes(dir) ? dir : null); return true; }

  async shutdown() { if (this.controller) { this.controller.abort(); await this.done?.catch(() => {}); } this._closeAll(); }

  _clockOn() { if (this.state && !this.state.runningSince) this.state.runningSince = new Date(this.now()).toISOString(); }
  _clockOff() {
    if (!this.state?.runningSince) return;
    this.state.activeMs = (this.state.activeMs || 0) + Math.max(0, this.now() - Date.parse(this.state.runningSince));
    this.state.runningSince = null;
  }

  _launch() {
    this._clockOn();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.done = this._run(signal).then(() => {
      this.state.status = 'done';
      this.state.finishedAt = new Date(this.now()).toISOString();
      this.state.step = 'done';
      this._log('success', 'at2.done', this._totals(), 'Auto Trade finished');
      this.onAttention?.('done');
    }, async error => {
      // Stopped (by hand or by another task such as a PVP schedule) or failed: the spenders
      // that got players first put them on the market, or their salary cap stays full and
      // they miss tournaments (user 2026-11-06). Not when the game itself is unreachable.
      if (!(this.gameHealth && isNetError(error))) await this._wrapUp('stop');
      if (error?.name === 'AbortError') {
        this.state.status = 'stopped';
        this.state.step = 'stopped';
        this._log('warning', 'at2.stopped', {}, 'Auto Trade stopped');
      } else if (this.gameHealth && isNetError(error)) {
        // The game is unreachable: wait for the shared check, then continue from the
        // same place by itself (the same as pressing Continue).
        this.state.status = 'waitingGame';
        this.state.step = 'waitingGame';
        this._log('warning', 'at2.waitGame', { error: error.message }, `Game not reachable (${error.message}) · Auto Trade continues when it is back`);
        this.gameHealth.reportDown('Auto Trade', error);
        this.gameHealth.waitUp().then(() => { if (this.state?.status === 'waitingGame' && !this.controller) this.continue(); });
      } else {
        this.state.status = 'error';
        this.state.error = { message: error.message, code: error.code || null, params: error.params || {}, userFix: Boolean(error.userFix) };
        this._log('error', error.code || 'at2.failed', { ...(error.params || {}), error: error.message }, `Auto Trade stopped: ${error.message}`);
        this.onAttention?.('error', error.message);
      }
    }).finally(() => {
      this._clockOff();
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
    if (this._bypass.getStore() || this._spLock.als.getStore()) return;
    while (this.pauseGate) { await this.pauseGate.promise; if (signal.aborted) throw abortError(); }
  }

  // ---------- connections ----------
  async _open(id, signal) {
    if (this.conns.has(id)) { this._parked?.delete(id); return this.conns.get(id); }
    const pending = this._opening.get(id);
    if (pending) return pending;
    const p = this._openNow(id, signal);
    this._opening.set(id, p);
    try { return await p; } finally { this._opening.delete(id); }
  }

  async _openNow(id, signal) {
    while (this._held?.get(id)) await sleep(500, signal); // the user's hand work on it first
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    this._step('opening', { name: account.name }, id);
    // an account outside the run (a Harcayıcı): its Auto Play steps aside while it is open
    if (this.pauseAccount && !this.state.config.accountIds.includes(id) && !this.resumers.has(id)) {
      const resume = await this.pauseAccount(id, 'Auto Trade').catch(() => null);
      if (resume) this.resumers.set(id, resume);
    }
    let conn;
    try { conn = await TradeGameAccount.open({ account, sessions: this.sessions, createSocket: this.createSocket, signal }); }
    catch (error) { this._resume(id); throw error; }
    this.conns.set(id, conn);
    const acc = this._acc(id) || this._ensureAcc(id);
    acc.openedAt = new Date(this.now()).toISOString();
    acc.visits += 1;
    acc.funds = await conn.funds().catch(() => acc.funds);
    if (acc.fundsStart == null) acc.fundsStart = acc.funds;
    this._log('info', 'at2.opened', { name: account.name }, `${account.name} opened`, id);
    this._tick('open');
    this._save();
    return conn;
  }

  _close(id) {
    this._parked?.delete(id);
    const conn = this.conns.get(id);
    if (!conn) return;
    conn.close();
    this.conns.delete(id);
    this._resume(id);
    const acc = this.state?.accounts?.[id];
    if (acc?.openedAt) { acc.openMs = (acc.openMs || 0) + (this.now() - Date.parse(acc.openedAt)); acc.openedAt = null; }
  }

  // A Harcayıcı connection is kept for a while instead of closed: the next listing or trade on
  // it needs no sign-in (~10 s each). At most 4 are kept; one unused for 3 minutes is closed.
  _park(id) {
    if (this.state?.config?.accountIds?.includes(id) || this._busy(id)) return this._close(id);
    const parked = (this._parked ||= new Map());
    parked.set(id, this.now());
    for (const [pid, at] of [...parked]) {
      if (pid !== id && this.now() - at > 3 * 60 * 1000) { parked.delete(pid); this._close(pid); }
    }
    while (parked.size > 4) { const [old] = parked.keys(); parked.delete(old); this._close(old); }
  }

  // An account the user works on by hand (a listing, a fire): Auto Trade does not open it until
  // the hand work is done, and goes on with the others (no stop / continue of the whole run).
  usesAccount(id) { return this.conns.has(id) || this._busy(id); }
  _busy(id) { return Boolean(this.state?.activeSides?.includes(id) || this.state?.currentSideId === id); }
  holdAccounts(ids) {
    const held = (this._held ||= new Map());
    for (const id of ids) held.set(id, (held.get(id) || 0) + 1);
    return () => { for (const id of ids) { const n = (held.get(id) || 1) - 1; if (n > 0) held.set(id, n); else held.delete(id); } };
  }

  _resume(id) { const r = this.resumers.get(id); if (!r) return; this.resumers.delete(id); Promise.resolve().then(r).catch(() => {}); }

  _closeAll() { for (const id of [...this.conns.keys()]) this._close(id); this.friendNet?.closeAll?.(); }

  // ---------- the run ----------
  async _run(signal) {
    const cfg = this.state.config;
    const maxCycles = cfg.loopMode === 'infinite' ? Infinity : cfg.loopMode === 'count' ? cfg.loopCount : 1;
    while (this.state.cycle <= maxCycles) {
      await this._gate(signal);
      if (this.state.stage === 'prep') {
        await this._prepStage(signal);
        this.state.stage = 'main';
        this._save();
      }
      if (this.state.stage === 'main') {
        await this._friendSync(signal);
        if (this.state.cycle === 1) await this._spenderSweep(signal);
        if (this.state.cycle > 1) await this._waitScout(cfg.mainId, signal);
        await this._mainTurn(signal);
        this.state.stage = 'sides';
        this._save();
      }
      if (this.state.stage === 'sides') await this._sidesStage(signal);
      // Whatever came to main last is turned into cards before the cycle ends.
      if (this.conns.has(cfg.mainId)) { await this._convertMain(signal); await this._mainToSpenders(signal); }
      await this._flushSpenders(signal, { skipBusy: false });
      await this._restoreParked(cfg.mainId, signal);
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

  // `n` workers take items until none is left; the first real error stops the others.
  async _pool(n, signal, worker) {
    const inner = new AbortController();
    const sig = AbortSignal.any([signal, inner.signal]);
    let first = null;
    await Promise.all(Array.from({ length: Math.max(1, n) }, () => worker(sig).catch(error => {
      if (!first || (first.name === 'AbortError' && error?.name !== 'AbortError')) first = error;
      inner.abort();
    })));
    if (signal.aborted) throw abortError();
    if (first) throw first;
  }
  _parallel() { return Math.max(1, Math.min(PARALLEL_MAX, Number(this.state?.config?.parallelSides) || PARALLEL_DEFAULT)); }

  // Sides run a few at a time; each takes the next one (highest TK first) when it is done.
  // A stopped run continues the sides that were in their turn.
  async _sidesStage(signal) {
    const s = this.state;
    s.activeSides ||= [];
    if (s.currentSideId && !s.activeSides.includes(s.currentSideId)) s.activeSides.push(s.currentSideId);
    const resume = [...s.activeSides];
    const claim = () => this._claimLock.run(async () => {
      const next = resume.shift() || await this._nextSide();
      if (next && !s.activeSides.includes(next)) s.activeSides.push(next);
      s.currentSideId = s.activeSides[0] || null;
      this._save();
      return next;
    });
    await this._pool(this._parallel(), signal, async sig => {
      for (;;) {
        await this._gate(sig);
        const next = await claim();
        if (!next) return;
        if (s.cycle > 1) await this._waitScout(next, sig);
        const t0 = this.now();
        const result = await this._sideTurn(next, sig);
        this._acc(next).status = result?.skipped ? 'skipped' : 'done';
        (result?.skipped ? s.sidesSkipped : s.sidesDone).push(next);
        s.activeSides = s.activeSides.filter(id => id !== next);
        s.currentSideId = s.activeSides[0] || null;
        s.turnMs = (s.turnMs || 0) + (this.now() - t0);
        s.turns = (s.turns || 0) + 1;
        this._close(next);
        this._save();
        // what the spenders got in this turn goes to the market now, not only at the end of
        // the cycle (user 2026-11-07: a cycle of 100+ accounts takes hours, nothing was listed)
        await this._flushSpenders(sig);
      }
    });
  }

  // ---------- Hazırlık: the bench decisions of every account before any Scout ----------
  _freshPrep() {
    const p = this.prep;
    return p && p.status === 'done' && p.at && !p.usedBy && this.now() - Date.parse(p.at) < PREP_VALID_MS ? p : null;
  }

  // One account: list / fire what the user chose (a sign-in only when needed); trade / card
  // decisions become rows of the run. A player that appears later is left alone.
  async _prepAccount(id, decisions, signal, cfg) {
    const out = { rows: {}, listed: 0, fired: 0 };
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) return out;
    let userId = this._userIdOf(id);
    if (!userId) userId = (await this.sessions.get(account, { owner: 'auto-trade' })).userId;
    const anon = await GameSocket.open({ createSocket: this.createSocket, signal });
    let roster;
    try { roster = R.rosterOf(await anon.ack('getTeamOptimized', { userId })); } finally { anon.close(); }
    const acts = roster.bench.map(p => [p, decisions?.[p.id]])
      .filter(([p, d]) => d && d.action && d.action !== 'none' && !(R.fireOnly(p) ? d.action !== 'fire' : R.tradeBlock(p)));
    let conn = this.conns.get(id) || null;
    let own = false;
    try {
      if (!conn && acts.some(([, d]) => d.action === 'list' || d.action === 'fire')) {
        conn = await TradeGameAccount.open({ account, sessions: this.sessions, createSocket: this.createSocket, signal });
        own = true;
      }
      for (const [p, d] of acts) {
        if (signal.aborted) throw abortError();
        if (d.action === 'list') {
          const r = await conn.sell(p.id, d.price, d.currency);
          this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.listed' : 'at2.listFailed', { name: p.name, price: d.price, currency: d.currency, error: r?.message || '' }, `${p.name} listed · ${d.price} ${d.currency}`, id);
          if (r?.success) out.listed += 1;
        } else if (d.action === 'fire') {
          // confirmed by the user before
          const r = await conn.fire(p.id);
          this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.fired' : 'at2.fireFailed', { name: p.name, error: r?.error || r?.message || '' }, r?.success ? `${p.name} fired` : `${p.name} could not be fired: ${r?.error || r?.message || ''}`, id);
          if (r?.success) out.fired += 1;
        } else {
          // 'card': to main and into a star card whatever its roles say
          const row = this._row(p, cfg, undefined, undefined, { status: 'existing' });
          if (d.action === 'card') row.dir = 'main';
          if (row.dir) out.rows[p.id] = { ...row, preexisting: true };
        }
      }
    } finally { if (own) conn.close(); }
    return out;
  }

  _takeRows(id, rows) {
    const acc = this._acc(id);
    for (const [pid, row] of Object.entries(rows || {})) if (!acc.players[pid]) acc.players[pid] = { ...row, status: this._statusFor(row.dir, acc.role) };
  }

  // Before main's turn: every account's bench decisions in one go, a few accounts at a time.
  async _prepStage(signal) {
    const s = this.state;
    const decisions = s.config.benchDecisions || {};
    const remembered = s.prepFrom?.accounts || {};
    for (const id of s.config.accountIds) if (remembered[id]) { this._takeRows(id, remembered[id].rows); this._acc(id).benchApplied = true; }
    const todo = s.config.accountIds.filter(id => !this._acc(id).benchApplied && Object.values(decisions[id] || {}).some(d => d?.action && d.action !== 'none'));
    if (todo.length) {
      let i = 0, done = 0;
      this._step('prep', { done, total: todo.length });
      this._log('info', 'at2.prepStarted', { count: todo.length }, `Bench decisions of ${todo.length} account(s) first`);
      await this._pool(this._parallel(), signal, async sig => {
        for (;;) {
          await this._gate(sig);
          const id = todo[i++];
          if (!id) return;
          const out = await this._prepAccount(id, decisions[id], sig, s.config);
          this._takeRows(id, out.rows);
          this._acc(id).listed += out.listed;
          this._acc(id).benchApplied = true;
          this._step('prep', { done: ++done, total: todo.length });
          this._save();
        }
      });
      this._log('success', 'at2.prepDone', { count: todo.length }, `Bench decisions done · ${todo.length} account(s)`);
    }
    for (const id of s.config.accountIds) this._acc(id).benchApplied = true;
    s.prepFrom = null;
  }

  // Hazırlık without a run: the same bench work; a start within the hour does not ask again.
  async prepare(options = {}) {
    if (this.controller) throw new Error('Auto Trade is running.');
    if (this._preparing) throw new Error('Hazırlık is already running.');
    const all = this.store.getAccounts();
    const ids = (options.accountIds || []).filter(id => all.some(a => a.id === id) && !this._tradeLocked(id));
    const decisions = options.benchDecisions || {};
    const cfg = this._config(options);
    const todo = ids.filter(id => Object.values(decisions[id] || {}).some(d => d?.action && d.action !== 'none'));
    const ctrl = new AbortController();
    this._prepCtrl = ctrl;
    this.prep = { status: 'running', startedAt: new Date(this.now()).toISOString(), at: null, total: todo.length, done: 0, accounts: {}, error: null };
    this._log('info', 'at2.prepStarted', { count: todo.length }, `Bench decisions of ${todo.length} account(s) first`);
    this._save();
    let i = 0;
    const n = Math.max(1, Math.min(PARALLEL_MAX, Math.floor(Number(options.parallelSides) || PARALLEL_DEFAULT)));
    this._preparing = this._pool(n, ctrl.signal, async sig => {
      for (;;) {
        const id = todo[i++];
        if (!id) return;
        const out = await this._prepAccount(id, decisions[id], sig, cfg);
        this.prep.accounts[id] = { rows: out.rows };
        this.prep.done += 1;
        this._save();
      }
    }).then(() => {
      for (const id of ids) this.prep.accounts[id] ||= { rows: {} };
      this.prep.status = 'done';
      this.prep.at = new Date(this.now()).toISOString();
      this._log('success', 'at2.prepDone', { count: todo.length }, `Bench decisions done · ${todo.length} account(s)`);
    }, error => {
      this.prep.status = error?.name === 'AbortError' ? 'stopped' : 'error';
      this.prep.error = error?.name === 'AbortError' ? null : error.message;
      this._log('warning', 'at2.prepFailed', { error: error?.message || '' }, `Hazırlık stopped: ${error?.message || ''}`);
    }).finally(() => { this._preparing = null; this._prepCtrl = null; this._save(); });
    return this.snapshot();
  }
  stopPrepare() { this._prepCtrl?.abort(); return this.snapshot(); }
  clearPrepare() { if (!this._preparing) { this.prep = null; this._save(); } return this.snapshot(); }

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
    const left = s.config.accountIds.filter(id => id !== s.config.mainId && !s.sidesDone.includes(id) && !s.sidesSkipped.includes(id) && !(s.activeSides || []).includes(id));
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
        if (Number.isFinite(Number(info?.funds))) { const a = this._acc(id); a.funds = Number(info.funds); if (a.fundsStart == null) a.fundsStart = a.funds; }
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
    await this._friendBoards(id, 'main', signal);
    await this._convertMain(signal);
    await this._mainToSpenders(signal);
    await this._restoreParked(id, signal);
  }

  async _sideTurn(id, signal) {
    this._acc(id).status = 'active';
    await this._open(id, signal);
    await this._open(this.state.config.mainId, signal);
    await this._applyBench(id, signal);
    this._log('info', 'at2.sideTurn', { name: this._name(id), funds: this._acc(id).funds }, `${this._name(id)} (side) · ${this._acc(id).funds} TK`, id);
    try {
      let r = await this._tradeWithMain(id, signal);
      if (r?.skipped) return r;
      // the Satılabilir / Stok it holds (also what main unloaded here) leave before scouting,
      // so the Scout has room and every card does not need a trade of its own
      await this._sideToSpender(id, signal);
      const scout = await this._scout(id, 'side', signal);
      if (!scout?.skipped) await this._friendBoards(id, 'side', signal);
      r = await this._tradeWithMain(id, signal);
      if (r?.skipped) return r;
      await this._sideToSpender(id, signal);
      if (this._friendsOn() && this._accountRoleId(id) === 'spender') this._spenderTodo.add(id);
      return scout?.skipped ? scout : {};
    } finally {
      if (!signal.aborted) {
        await this._restoreParked(id, signal).catch(error => this._log('error', 'os.restoreFailed', { name: this._name(id), error: error.message }, error.message, id));
        await this._mainLock.run(() => this._restoreParked(this.state.config.mainId, signal)).catch(() => {});
      }
    }
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
      if (!d || d.action === 'none') continue;
      // a 1-salary player that cannot be traded may only be fired; other blocked players are left alone
      if (R.fireOnly(p) ? d.action !== 'fire' : R.tradeBlock(p)) continue;
      if (d.action === 'list') {
        await this._gate(signal);
        const r = await conn.sell(p.id, d.price, d.currency);
        this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.listed' : 'at2.listFailed', { name: p.name, price: d.price, currency: d.currency, error: r?.message || '' }, `${p.name} listed · ${d.price} ${d.currency}`, id);
        if (r?.success) acc.listed += 1;
      } else if (d.action === 'fire') {
        // confirmed by the user before the start
        await this._gate(signal);
        const r = await conn.fire(p.id);
        this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.fired' : 'at2.fireFailed', { name: p.name, error: r?.error || r?.message || '' }, r?.success ? `${p.name} fired` : `${p.name} could not be fired: ${r?.error || r?.message || ''}`, id);
      } else if (d.action === 'trade' || d.action === 'card') {
        // 'card': to main and into a star card whatever its roles say
        const row = this._row(p, cfg, undefined, undefined, { status: 'existing' });
        if (d.action === 'card') row.dir = 'main';
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

  _ownedSwap(id) {
    const conn = this.conns.get(id);
    return new OwnedSwap({ gs: conn.conn, userId: conn.userId, log: (level, code, params, message) => this._log(level, code, params, message, id) });
  }

  // Originals parked for an already-owned Scout player come back once the signed copy
  // has left the roster (traded, turned into cards or listed). Kept in the run state, so
  // a restart or a later listing still restores them.
  async _restoreParked(id, signal) {
    const acc = this._acc(id);
    const ids = Object.keys(acc.parked || {});
    if (!ids.length) return;
    let opened = false;
    try {
      if (!this.conns.has(id)) { await this._open(id, signal); opened = true; }
      const roster = R.rosterOf(await this.conns.get(id).roster());
      for (const pid of ids) {
        if (roster.ids.has(pid)) continue; // the signed copy is still here
        const back = await this._ownedSwap(id).restore(acc.parked[pid]).catch(error => ({ ok: false, message: error.message }));
        if (back.ok) { delete acc.parked[pid]; this._save(); }
        else if (back.reason !== 'copyInRoster') this._log('error', 'os.restoreFailed', { name: acc.parked[pid].name, error: back.message || back.reason }, `${acc.parked[pid].name}: the original could not be brought back · ${back.message || back.reason}`, id);
      }
    } finally {
      if (opened) this._close(id);
    }
  }

  async _scout(id, role, signal) {
    const conn = this.conns.get(id);
    const acc = this._acc(id);
    // a side signs only what its account role allows, with the role's own price limit
    const rule = role === 'main' ? null : this._ruleFor(id);
    const cfg = R.configFor(this.state.config, rule);
    const roleMap = this._roleMap();
    const roleNames = this._roleNames();
    // A side buys main-bound players only as far as main's TK pays for them (`_mainLeft`:
    // what every side already holds for main counts against it).
    // its own callbacks change its board: friends read it again
    this._boardSeen?.delete(conn.userId);
    const team = this._teamPlayers();
    let budgetNoted = false;
    for (let round = 0; round < 50; round++) {
      await this._gate(signal);
      let fa = await conn.freeAgents();
      if (fa?.cooldownEnds && fa.cooldownEnds <= this.now()) fa = await conn.freeAgents(); // 00:00 → the fresh list
      acc.scout = { attemptsLeft: fa?.attemptsLeft ?? null, cooldownEnds: fa?.cooldownEnds ?? null, at: new Date(this.now()).toISOString() };
      this.onScout?.(id, fa);
      let roster = R.rosterOf(await conn.roster());
      acc.funds = await conn.funds().catch(() => acc.funds);
      if (this._friendsOn()) {
        for (const agent of (fa?.freeAgents || []).filter(a => !a.isSigned && R.classify(a, this.state.config, roleMap) === 'side')) {
          await this._gate(signal);
          if (role === 'side' && this._ownSpenderTakes(conn.userId, agent, roleMap)) continue; // a Harcayıcı's own Scout: it signs it below
          let handled = false;
          if (this._needsLv30(agent, roleMap)) handled = await this._stokBuy(conn.userId, agent, signal, id) === 'done';
          else { const sp = await this._spenderFor(conn.userId, agent, signal, id); handled = Boolean(sp && await this._spenderBuy(sp, conn.userId, agent, signal)); }
          if (handled) fa = { ...fa, freeAgents: (fa.freeAgents || []).map(a => a.id === agent.id ? { ...a, isSigned: true } : a) };
        }
      }
      // Stok is signed only by Lv30+ accounts (user 2026-11-06)
      const lowLevel = this._level(id) < 30;
      const candidates = (fa?.freeAgents || []).filter(a => !a.isSigned && !(acc.parked || {})[a.id] && !(lowLevel && this._needsLv30(a, roleMap)) && R.classify(a, cfg, roleMap) && R.accountAllows(rule, R.signReason(a, cfg, roleMap), a, roleMap, cfg));
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
          // main short of TK: this one is left, cheaper ones are still bought (no stop)
          if (role === 'main') {
            this._log('warning', 'at2.mainFundsSkip', { name: this._name(id), funds: acc.funds, need: price, player: agent.name }, `${this._name(id)}: ${acc.funds} TK, ${agent.name} costs ${price} TK · not bought`, id);
            continue;
          }
          this._log('warning', 'at2.sideFunds', { name: this._name(id), funds: acc.funds, need: price }, `${this._name(id)}: not enough TK, account skipped`, id);
          return { skipped: true };
        }
        // main-bound (or "ask") on a side: main must be able to pay it in the trade
        if (role === 'side' && R.classify(agent, cfg, roleMap, team) !== 'side' && !this._mainPays(price, agent.name, id, budgetNoted)) { budgetNoted = true; continue; }
        // Already in the roster: park our copy (equipment, skill, lineup remembered) so the
        // Scout one can be signed; ours comes back once the new one has left the roster.
        if (roster.ids.has(agent.id)) {
          const os = this._ownedSwap(id);
          const prep = await os.prepare(agent.id, agent.name).catch(error => ({ ok: false, reason: 'failed', message: error.message }));
          if (!prep.ok) {
            if (prep.reason === 'noListings') this._log('info', 'os.skipScout', { player: agent.name }, `${agent.name} is already in the roster and there is no own listing to make room · skipped`, id);
            else this._log('warning', 'os.failed', { name: agent.name, error: prep.message || prep.reason }, `${agent.name}: the already-owned workaround failed · ${prep.message || prep.reason}`, id);
            continue;
          }
          (acc.parked ||= {})[agent.id] = prep.record;
          this._save();
          roster = R.rosterOf(await conn.roster());
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
        if (row.dir === 'ask') row.dir = await this._askRole(id, row, signal);
        row.status = row.dir ? this._statusFor(row.dir, role) : 'none';
        row.discounted = salary < price;
        acc.players[agent.id] = row;
        if (cfg.baseAsSellable && row.dir === 'side' && R.classify(agent, { ...cfg, baseAsSellable: false }, roleMap) === 'main') {
          this._log('info', 'at2.baseSellable', { player: agent.name, salary, base: signedAs?.newBaseSalary ?? agent.newBaseSalary }, `${agent.name} signed at ${salary} (Base) → treated as Satılabilir`, id);
        }
        acc.bought += 1;
        acc.spent += salary; // a discount (Lv30+) lowers what is paid too: paid = salary (user 2026-11-05)
        acc.funds = Number.isFinite(acc.funds) ? acc.funds - salary : acc.funds;
        roster.total += 1;
        roster.ids.add(agent.id);
        this._log('success', 'at2.signed', { player: agent.name, price: salary, dir: row.dir }, `${agent.name} signed · ${salary} TK`, id);
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

  // ---------- friends (game update 2026-11-05) ----------
  _friendsOn() { return Boolean(this.friendNet && this.state.config.friendBoards); }
  _dayKey() { return new Date(this.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); } // the game's day (Manila)
  // Every Harcayıcı account (the role decides, not the run's account list); never main.
  _spenderIds() {
    return this.store.getAccounts().filter(a => a.role === 'spender' && a.id !== this.state.config.mainId && this._userIdOf(a.id)).map(a => a.id);
  }
  _level(id) { return Number(this.store.getAccountProfile?.()?.accounts?.[id]?.level) || 0; }
  // A Satılabilir / Stok player on the Scout of a Harcayıcı of this run whose turn is still to
  // come (or running): that Harcayıcı signs it itself from its own Scout, so another account
  // does not take it off the board and trade it back (user 2026-11-07: sides with an earlier
  // turn emptied the spenders' Scouts).
  _ownSpenderTakes(ownerUserId, agent, roleMap = this._roleMap()) {
    const owner = this.friendNet?.accountOfUser?.(ownerUserId);
    const s = this.state;
    if (!owner || owner === s.config.mainId || this._accountRoleId(owner) !== 'spender') return false;
    if (!s.config.accountIds.includes(owner) || s.sidesDone.includes(owner) || s.sidesSkipped.includes(owner)) return false;
    if (this._level(owner) < 30 && this._needsLv30(agent, roleMap)) return false;
    if (!this._mayTake(owner, agent, roleMap)) return false;
    const funds = this._acc(owner)?.funds;
    const price = Number(agent.baseSalary) || 0;
    return !Number.isFinite(funds) || funds - price >= (s.config.spenderMinTk || 0);
  }
  // What main can still pay for: its TK minus what every side holds for it.
  _mainLeft() {
    const mainId = this.state.config.mainId;
    const funds = this._acc(mainId)?.funds;
    if (!Number.isFinite(funds)) return Infinity;
    let pending = 0;
    for (const [id, acc] of Object.entries(this.state.accounts)) {
      if (id === mainId) continue;
      for (const r of Object.values(acc.players || {})) if (r.dir === 'main' && ['toTrade', 'trading'].includes(r.status)) pending += Number(r.signedSalary) || Number(r.salary) || 0;
    }
    return funds - pending;
  }
  // true: main pays this one. false: skipped. Main's TK at its end: the run stops (choice of
  // the user 2026-11-07: a notice and a stop, then the stop's wrap-up).
  _mainPays(price, player, id, noted = false) {
    const left = this._mainLeft();
    if (price <= left) return true;
    if (left < MAIN_TK_FLOOR) throw this._outOfTk();
    if (!noted) this._log('warning', 'at2.mainBudget', { main: this._name(this.state.config.mainId), left: Math.max(0, Math.floor(left)), need: price, player }, `Main has TK for ${Math.max(0, Math.floor(left))} more · ${player} (${price} TK) is not bought for it`, id);
    return false;
  }
  _outOfTk() {
    const mainId = this.state.config.mainId;
    const funds = Math.floor(Number(this._acc(mainId)?.funds) || 0);
    return new UserFixError(`${this._name(mainId)} has ${funds} TK · not enough for the cheap players, Auto Trade stops`, 'at2.mainOutOfTk', { main: this._name(mainId), funds });
  }

  _isStok(agent, roleMap = this._roleMap()) {
    const stok = (this.store.getCardRoles?.() || []).filter(r => /^stok|^stock/i.test(String(r.name).trim())).map(r => r.id);
    return (roleMap.get(agent.id) || []).some(r => stok.includes(r));
  }
  _blocked(id) { return this.state.friendBlocked?.[id] === this._dayKey(); }
  _block(id, message) {
    (this.state.friendBlocked ||= {})[id] = this._dayKey();
    this._log('warning', 'at2.friendLimit', { name: this._name(id), error: message }, `${this._name(id)}: signing from friends refused for today · ${message}`, id);
  }
  _ensureAcc(id) {
    this.state.accounts[id] ||= { id, name: this._name(id), role: 'side', status: 'waiting', players: {}, bought: 0, spent: 0, converted: 0, tradesIn: 0, tradesOut: 0, tkPaid: 0, tkReceived: 0, listed: 0, openMs: 0, openedAt: null, visits: 0, funds: null, fundsStart: null, scout: null, benchApplied: true };
    return this.state.accounts[id];
  }

  // The network: every account gets a Harcayıcı friend, old friends leave the Harcayıcı lists.
  async _friendSync(signal) {
    if (!this._friendsOn()) return;
    await this._gate(signal);
    this._step('friendSync', {}, null);
    try { await this.friendNet.sync({ signal }); }
    catch (error) { if (error?.name === 'AbortError') throw error; this._log('warning', 'at2.friendSyncFailed', { error: error.message }, `Friend network could not be updated: ${error.message}`); }
  }

  // A spender that may take this Satılabilir / Stok player off the board of `ownerUserId`: its
  // own role rules allow it, it is a friend of the board's owner and has the TK. null = none
  // (then the side signs it the old way).
  async _spenderFor(ownerUserId, agent, signal, viewerId = null) {
    const roleMap = this._roleMap();
    const price = Number(agent.baseSalary) || 0;
    const floor = this.state.config.spenderMinTk || 0;
    if (R.classify(agent, this.state.config, roleMap) !== 'side') return null;
    // only spenders whose row in the role table allows this player (user 2026-11-05)
    const spenders = this._spenderIds().filter(id => !this._blocked(id) && !this._busy(id) && this._userIdOf(id) !== ownerUserId && this._mayTake(id, agent, roleMap));
    spenders.forEach(id => this._ensureAcc(id));
    await this._refreshFunds(spenders.filter(id => this.state.accounts[id].funds == null));
    let order = R.sideOrder(spenders.map(id => ({ id, funds: this.state.accounts[id].funds }))).map(x => x.id);
    // Stok: a Lv30+ account signs it (5% salary cut chance) — a Lv30+ Harcayıcı, else the
    // Lv30+ viewer itself (it hands it to a Harcayıcı later), else any Harcayıcı.
    if (this._needsLv30(agent, roleMap)) order = order.filter(id => this._level(id) >= 30);
    return this._firstSpender(order, ownerUserId, price, floor, signal);
  }
  // Stok is signed only by a Lv30+ account (5% salary cut chance; user 2026-11-06). In order:
  // a Lv30+ Harcayıcı that is a friend of the owner → a Lv30+ Harcayıcı made a friend of the
  // owner for this one signing → the viewer itself when Lv30+ ('self') → another Lv30+ account
  // of ours (friend, or a friend for the moment), which trades it on to a Harcayıcı → nobody
  // ('skip'). A friendship for the moment is removed right after (from one side: it is mutual);
  // only boards of our own accounts can get one, never Main's.
  async _stokBuy(ownerUserId, agent, signal, viewerId = null) {
    const roleMap = this._roleMap();
    const price = Number(agent.baseSalary) || 0;
    const floor = this.state.config.spenderMinTk || 0;
    const mainId = this.state.config.mainId;
    const ownerAcc = this.friendNet.accountOfUser?.(ownerUserId) || null;
    const tempOk = Boolean(ownerAcc) && ownerAcc !== mainId;
    const ok = id => id !== mainId && !this._blocked(id) && !this._busy(id) && this._userIdOf(id) && this._userIdOf(id) !== ownerUserId && this._level(id) >= 30 && this._mayTake(id, agent, roleMap);
    const spenders = this._spenderIds().filter(ok);
    spenders.forEach(id => this._ensureAcc(id));
    await this._refreshFunds(spenders.filter(id => this.state.accounts[id].funds == null));
    const spOrder = R.sideOrder(spenders.map(id => ({ id, funds: this.state.accounts[id].funds }))).map(x => x.id)
      .filter(id => !Number.isFinite(this.state.accounts[id].funds) || this.state.accounts[id].funds - price >= floor);
    const friendSp = await this._firstSpender(spOrder, ownerUserId, price, floor, signal);
    if (friendSp && await this._spenderBuy(friendSp, ownerUserId, agent, signal)) return 'done';
    if (tempOk) {
      for (const sp of spOrder.filter(id => id !== friendSp)) {
        if (await this._tempFriend(sp, ownerAcc, () => this._spenderBuy(sp, ownerUserId, agent, signal), signal)) return 'done';
      }
    }
    if (viewerId && viewerId !== ownerAcc && this._level(viewerId) >= 30 && this._mayTake(viewerId, agent, roleMap)) return 'self';
    const spenderSet = new Set(this._spenderIds());
    const helpers = (this.store.getAccounts?.() || []).map(a => a.id).filter(id => !spenderSet.has(id) && id !== viewerId && ok(id));
    helpers.forEach(id => this._ensureAcc(id));
    await this._refreshFunds(helpers);
    const hOrder = R.sideOrder(helpers.map(id => ({ id, funds: this.state.accounts[id].funds }))).map(x => x.id)
      .filter(id => !Number.isFinite(this.state.accounts[id].funds) || this.state.accounts[id].funds >= price);
    const ownerFriends = ownerAcc ? await this.friendNet.friendsOf(ownerAcc, { signal }).catch(() => null) : null;
    for (const h of hOrder) {
      const reach = ownerFriends ? ownerFriends.ids.has(this._userIdOf(h)) : await this.friendNet.isFriend(h, ownerUserId, { signal }).catch(() => false);
      if (reach && await this._helperSign(h, ownerUserId, agent, signal)) return 'done';
    }
    if (tempOk) {
      for (const h of hOrder) {
        if (ownerFriends?.ids?.has(this._userIdOf(h))) continue;
        if (await this._tempFriend(h, ownerAcc, () => this._helperSign(h, ownerUserId, agent, signal), signal)) return 'done';
      }
    }
    this._log('info', 'at2.stokSkipped', { player: agent.name }, `${agent.name} (Stok): no Lv30+ account could sign it · left`, viewerId);
    return 'skip';
  }

  // \`buyerId\` and our account \`ownerAccId\` are friends only for \`fn\` (one signing).
  async _tempFriend(buyerId, ownerAccId, fn, signal) {
    const [b, o] = await Promise.all([buyerId, ownerAccId].map(id => this.friendNet.friendsOf(id, { signal }).catch(() => null)));
    if (!b || !o || b.ids.size >= 49 || o.ids.size >= 49) return false;
    try { await this.friendNet._befriend(buyerId, ownerAccId, signal); }
    catch (error) {
      if (error?.name === 'AbortError') throw error;
      this._log('warning', 'at2.tempFriendFailed', { name: this._name(buyerId), owner: this._name(ownerAccId), error: error.message }, `${this._name(buyerId)} ↔ ${this._name(ownerAccId)}: friendship for Stok failed · ${error.message}`, buyerId);
      return false;
    }
    this._log('info', 'at2.tempFriend', { name: this._name(buyerId), owner: this._name(ownerAccId) }, `${this._name(buyerId)} ↔ ${this._name(ownerAccId)}: friends for one Stok signing`, buyerId);
    try { return await fn(); }
    finally {
      // always undone, also after a stop
      await this.friendNet._unfriend(buyerId, this._userIdOf(ownerAccId)).catch(error =>
        this._log('warning', 'at2.tempUnfriendFailed', { name: this._name(buyerId), owner: this._name(ownerAccId), error: error.message }, `${this._name(buyerId)} ↔ ${this._name(ownerAccId)}: the friendship could not be removed · ${error.message}`, buyerId));
    }
  }

  // A Lv30+ account that is not a Harcayıcı signs a Stok (plain connection); at the end of the
  // turn it trades it to a Harcayıcı.
  async _helperSign(h, ownerUserId, agent, signal) {
    const acc = this._ensureAcc(h);
    const price = Number(agent.baseSalary) || 0;
    const fr = await this.friendNet.fundsAndRoster(h, signal);
    if (Number.isFinite(fr.funds)) { acc.funds = fr.funds; if (acc.fundsStart == null) acc.fundsStart = fr.funds; }
    if (Number.isFinite(acc.funds) && acc.funds < price) return false;
    if (fr.ids.has(agent.id) || fr.total >= R.ROSTER_MAX) return false;
    const r = await this.friendNet.signFrom(h, ownerUserId, agent.id, signal);
    if (!r?.success) {
      const m = String(r?.message || r?.error || 'refused');
      if (/limit|daily|today|maximum|too many/i.test(m)) this._block(h, m);
      else if (!/not available|already signed/i.test(m)) this._log('warning', 'at2.signFailed', { player: agent.name, error: m }, `${agent.name} could not be signed`, h);
      return false;
    }
    const salary = Number(r.revealedPlayer?.id === agent.id && r.revealedPlayer?.signedSalary) || (r.salaryCut ? Math.round(price * 0.95) : price);
    const from = this.friendNet.friends?.get?.(h)?.names?.get(ownerUserId) || this._name(this.friendNet.accountOfUser?.(ownerUserId)) || '?';
    const row = this._row({ ...agent, signedSalary: salary }, this.state.config, undefined, undefined, { status: 'keep', from });
    row.discounted = salary < price;
    row.dir = 'side';
    acc.players[agent.id] = row;
    acc.bought += 1;
    acc.spent += salary;
    if (Number.isFinite(acc.funds)) acc.funds -= salary;
    this._stokHolders.add(h);
    this._log('success', 'at2.friendSigned', { name: this._name(h), player: agent.name, owner: from, price: salary }, `${this._name(h)} signed ${agent.name} off ${from}'s board · ${salary} TK`, h);
    this._save();
    await sleep(this.timing.stepMs, signal);
    return true;
  }

  // Would this account sign the player under its own role rules (main: always)?
  _mayTake(id, agent, roleMap) {
    const rule = this._ruleFor(id);
    const cfg = R.configFor(this.state.config, rule);
    return Boolean(R.classify(agent, cfg, roleMap)) && R.accountAllows(rule, R.signReason(agent, cfg, roleMap), agent, roleMap, cfg);
  }
  async _firstSpender(order, ownerUserId, price, floor, signal) {
    // A board of one of our accounts: its own friend list (one cached read) says which
    // spenders can reach it — friendship is two-sided, so 60 spender lists need not be read.
    const ownerAcc = this.friendNet.accountOfUser?.(ownerUserId);
    const ownerFriends = ownerAcc ? await this.friendNet.friendsOf(ownerAcc, { signal }).catch(() => null) : null;
    for (const sp of order) {
      const funds = this.state.accounts[sp].funds;
      if (Number.isFinite(funds) && funds - price < floor) continue;
      const reach = ownerFriends ? ownerFriends.ids.has(this._userIdOf(sp)) : await this.friendNet.isFriend(sp, ownerUserId, { signal });
      if (!reach) continue;
      return sp;
    }
    return null;
  }

  // The spender signs the player off its friend's board (plain connection, nobody signed out).
  // Its roster never fills: when full (or the player is already there) it lists its bench.
  async _spenderBuy(sp, ownerUserId, agent, signal) {
    const acc = this._ensureAcc(sp);
    const price = Number(agent.baseSalary) || 0;
    const fr = await this.friendNet.fundsAndRoster(sp, signal);
    if (Number.isFinite(fr.funds)) { acc.funds = fr.funds; if (acc.fundsStart == null) acc.fundsStart = fr.funds; }
    if (Number.isFinite(acc.funds) && acc.funds < price) return false;
    if (fr.ids.has(agent.id) || fr.total >= R.ROSTER_MAX) {
      // the whole bench of Satılabilir / Stok goes in one go: the next signings need no sign-in
      if (!(await this._spenderRoom(sp, [agent.id], 1, signal, { all: true }))) return false;
    }
    const r = await this.friendNet.signFrom(sp, ownerUserId, agent.id, signal);
    if (!r?.success) {
      const m = String(r?.message || r?.error || 'refused');
      if (/limit|daily|today|maximum|too many/i.test(m)) this._block(sp, m);
      else this._log('warning', 'at2.signFailed', { player: agent.name, error: m }, `${agent.name} could not be signed`, sp);
      return false;
    }
    const salary = Number(r.revealedPlayer?.id === agent.id && r.revealedPlayer?.signedSalary) || (r.salaryCut ? Math.round(price * 0.95) : price);
    const row = this._row({ ...agent, signedSalary: salary }, this.state.config, undefined, undefined, { status: 'keep', from: this.friendNet.friends.get(sp)?.names?.get(ownerUserId) || null });
    row.discounted = salary < price;
    row.dir = 'side';
    acc.role = 'spender';
    acc.players[agent.id] = row;
    acc.bought += 1;
    this._spenderTodo.add(sp);
    acc.spent += salary;
    if (Number.isFinite(acc.funds)) acc.funds -= salary;
    this._log('success', 'at2.spenderSigned', { name: this._name(sp), player: agent.name, price: salary }, `${this._name(sp)} signed ${agent.name} off a friend's board · ${salary} TK`, sp);
    this._save();
    await sleep(this.timing.stepMs, signal);
    return true;
  }

  // Room on a spender: its copies of `dupIds` and then enough bench players for `need` more go
  // to the market at the spender price (its roster never fills up). Kart / cheap players that
  // wait for main stay. Uses the connection the spender has, or opens one for the moment.
  async _spenderRoom(sp, dupIds, need, signal, { all = false } = {}) {
    const cfg = this.state.config;
    const wasOpen = this.conns.has(sp);
    const conn = await this._open(sp, signal);
    const acc = this._ensureAcc(sp);
    try {
      const roster = R.rosterOf(await conn.roster());
      const waitsForMain = p => acc.players[p.id]?.dir === 'main' && !['converted', 'listed', 'none'].includes(acc.players[p.id]?.status);
      const keepAlone = this.state.config.benchDecisions?.[sp] || {}; // "leave it" before the start
      const free = roster.bench.filter(p => !R.tradeBlock(p) && keepAlone[p.id]?.action !== 'none' && acc.players[p.id]?.status !== 'none');
      const pick = [];
      for (const id of dupIds || []) {
        if (!roster.ids.has(id)) continue;
        const own = free.find(p => p.id === id);
        if (!own) return false; // a starter / equipped copy cannot go
        pick.push(own);
      }
      if (all) {
        // every Satılabilir / Stok on its bench (bought, traded in, or left by an earlier run)
        const roleMap = this._roleMap();
        for (const p of free) {
          const row = acc.players[p.id];
          if (pick.includes(p) || waitsForMain(p)) continue;
          if (row ? row.dir === 'side' : R.classify(p, cfg, roleMap, this._teamPlayers()) === 'side') pick.push(p);
        }
      }
      // `need` places are made in any case (other bench players go too when the Satılabilir /
      // Stok are not enough); with `all` and no need, only those are listed
      const limit = need > 0 ? R.ROSTER_MAX - need : Infinity;
      for (const p of free) { if (roster.total - pick.length <= limit) break; if (!pick.includes(p) && !waitsForMain(p)) pick.push(p); }
      if (roster.total - pick.length > limit) return false;
      for (const p of pick) {
        await this._gate(signal);
        const { price, currency, fire } = this._listPrice(p, sp);
        if (fire) {
          // marked "fire when not 5% off" in Otomatik Fiyatlandırma: the junk copy goes, it is not listed
          const f = await conn.fire(p.id).catch(error => ({ success: false, message: error.message }));
          this._log(f?.success ? 'success' : 'warning', f?.success ? 'at2.firedNoDisc' : 'at2.fireFailed', { name: p.name, error: f?.error || f?.message || '' }, f?.success ? `${p.name} was not signed 5% off · fired` : `${p.name} could not be fired: ${f?.error || f?.message || ''}`, sp);
          if (f?.success && acc.players[p.id]) acc.players[p.id].status = 'fired';
          this._tick('fire');
          if (!f?.success && !all) return false;
          continue;
        }
        const r = await conn.sell(p.id, price, currency);
        this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.listed' : 'at2.listFailed', { name: p.name, price, currency, error: r?.message || '' }, `${p.name} listed · ${price} ${currency}`, sp);
        this._tick('list');
        if (!r?.success) { if (all) continue; return false; }
        acc.listed += 1;
        if (acc.players[p.id]) acc.players[p.id].status = 'listed';
        try { this.onSpenderListed?.({ accountId: sp, player: p, price, currency }); } catch {}
      }
      this._save();
      return true;
    } finally {
      if (!wasOpen && !this._busy(sp)) this._park(sp);
    }
  }

  // The spenders that got players in this turn put every Satılabilir / Stok on the market at
  // their default price (user 2026-11-06: bought players were left on the bench, unlisted).
  async _flushSpenders(signal, { skipBusy = true } = {}) {
    if (!this._friendsOn()) return;
    for (const h of [...this._stokHolders]) {
      if (skipBusy && this._busy(h)) continue;
      this._stokHolders.delete(h);
      if (h === this.state.config.mainId) continue;
      const wasOpen = this.conns.has(h);
      try { await this._open(h, signal); await this._sideToSpender(h, signal); }
      catch (error) {
        if (error?.name === 'AbortError') throw error;
        this._log('warning', 'at2.spenderTradeFailed', { name: this._name(h), error: error.message }, `${this._name(h)}: ${error.message}`, h);
      } finally { if (!wasOpen && !this._busy(h)) this._close(h); }
    }
    const ids = [...this._spenderTodo].filter(sp => !(skipBusy && this._busy(sp)));
    for (const sp of ids) this._spenderTodo.delete(sp);
    for (const sp of ids) {
      await this._gate(signal);
      try { await this._spenderRoom(sp, [], 0, signal, { all: true }); }
      catch (error) {
        if (error?.name === 'AbortError') throw error;
        this._log('warning', 'at2.spenderTradeFailed', { name: this._name(sp), error: error.message }, `${this._name(sp)}: ${error.message}`, sp);
      }
    }
  }

  // The run ends early (Stop, another task, an error) → 'stop': the cheap players waiting on
  // sides go to main as far as its TK pays, the rest are fired; the spenders and Stok holders
  // list / hand on what they got. Pause → 'pause': only the listing (user 2026-11-07). A
  // countdown is kept in state.wrapUp; a second Stop ends it at once.
  _listLeftovers() { return this._wrapUp('stop'); }
  _wrapUp(kind) {
    const run = (this._wrapChain || Promise.resolve()).then(() => this._wrapUpNow(kind));
    this._wrapChain = run.catch(() => {});
    return run;
  }
  _waitingCheap() {
    const mainId = this.state.config.mainId;
    return Object.entries(this.state.accounts).filter(([id]) => id !== mainId)
      .map(([id, acc]) => ({ id, count: Object.values(acc.players || {}).filter(r => r.dir === 'main' && ['toTrade', 'trading'].includes(r.status)).length }))
      .filter(x => x.count);
  }
  _wrapEstimate(sides) {
    let ms = 0, count = 0;
    if (sides.length) ms += EST.open + EST.convert;
    for (const s of sides) { ms += (this.conns.has(s.id) ? 0 : EST.open) + Math.ceil(s.count / R.TRADE_MAX) * EST.trade; count += s.count; }
    for (const sp of this._spenderTodo) {
      const n = Object.values(this.state.accounts[sp]?.players || {}).filter(r => r.dir === 'side' && r.status === 'keep').length || 1;
      ms += (this.conns.has(sp) ? 0 : EST.open) + n * EST.list;
      count += n;
    }
    for (const h of this._stokHolders) { ms += 2 * EST.open + EST.trade; count += 1; } // eslint-disable-line no-unused-vars
    return { ms, count };
  }
  // one step of the wrap-up done: the countdown moves
  _tick(kind) {
    const w = this.state?.wrapUp;
    if (!w) return;
    w.done = Math.min(w.total, w.done + (kind === 'open' || kind === 'convert' ? 0 : 1));
    w.remainingMs = Math.max(1000, w.remainingMs - (EST[kind] || 0));
    w.endsAt = new Date(this.now() + w.remainingMs).toISOString();
    this.onChanged?.();
  }
  async _wrapUpNow(kind) {
    if (!this.state) return;
    const sides = kind === 'stop' ? this._waitingCheap() : [];
    const spenders = this._friendsOn() ? this._spenderTodo.size + this._stokHolders.size : 0;
    if (!sides.length && !spenders) return;
    // after a stop the connections still belong to the stopped run (its signal): new ones
    if (kind === 'stop') for (const id of [...this.conns.keys()]) this._close(id);
    const ctrl = new AbortController();
    this._leftoverCtrl = ctrl;
    const timer = setTimeout(() => ctrl.abort(), 20 * 60 * 1000);
    const est = this._wrapEstimate(sides);
    const cheap = sides.reduce((n, s) => n + s.count, 0);
    this.state.wrapUp = { kind, total: est.count, done: 0, cheap, spenders, remainingMs: est.ms, endsAt: new Date(this.now() + est.ms).toISOString() };
    this._step('leftovers', { count: spenders, cheap });
    this._log('info', 'at2.leftovers', { count: spenders, cheap, seconds: Math.round(est.ms / 1000) }, `Auto Trade is ${kind === 'pause' ? 'pausing' : 'stopping'} · ${cheap} cheap player(s) on sides are settled, ${spenders} spender(s) list their players first`);
    this._save();
    try {
      await this._bypass.run(true, async () => {
        if (sides.length) await this._settleCheap(sides, ctrl.signal);
        await this._flushSpenders(ctrl.signal, { skipBusy: kind === 'pause' });
      });
      this._log('success', 'at2.leftoversDone', { count: spenders, cheap }, kind === 'pause' ? 'Spender players listed (paused)' : 'Players settled and listed before the stop');
    } catch (error) {
      this._log('warning', 'at2.leftoversFailed', { error: error?.name === 'AbortError' ? 'stopped' : error.message }, `Spender listing before the stop did not finish: ${error?.name === 'AbortError' ? 'stopped' : error.message}`);
    } finally {
      clearTimeout(timer);
      this._leftoverCtrl = null;
      if (this.state) this.state.wrapUp = null;
      this._save();
    }
  }
  // Cheap players waiting on sides: to main as far as its TK pays; what it cannot pay is fired
  // (choice of the user 2026-11-07). Players the user had on the bench before are never fired.
  async _settleCheap(sides, signal) {
    const mainId = this.state.config.mainId;
    await this._open(mainId, signal);
    for (const { id } of sides) {
      if (signal.aborted) throw abortError();
      const wasOpen = this.conns.has(id);
      try {
        await this._open(id, signal);
        const r = await this._tradeWithMain(id, signal, { settle: true });
        const acc = this._acc(id);
        const conn = this.conns.get(id);
        const onRoster = R.rosterOf(await conn.roster()).ids;
        for (const pid of r?.waiting || []) {
          const row = acc.players[pid];
          if (!row || row.preexisting || !onRoster.has(pid)) continue;
          const f = await conn.fire(pid).catch(error => ({ success: false, message: error.message }));
          if (f?.success) row.status = 'fired';
          this._tick('fire');
          this._log(f?.success ? 'success' : 'warning', f?.success ? 'at2.firedNoTk' : 'at2.fireFailed', { name: row.name, error: f?.error || f?.message || '' }, f?.success ? `${row.name} fired · main has no TK for it` : `${row.name} could not be fired: ${f?.error || f?.message || ''}`, id);
        }
        this._save();
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        this._log('warning', 'at2.settleFailed', { name: this._name(id), error: error.message }, `${this._name(id)}: cheap players could not be settled · ${error.message}`, id);
      } finally {
        if (!wasOpen) this._close(id);
      }
    }
    await this._convertMain(signal).catch(error => { if (error?.name === 'AbortError') throw error; });
  }

  // Start of a run: the spenders' benches are read without logging in; those holding
  // Satılabilir / Stok (earlier runs, a stop half way) list them.
  async _spenderSweep(signal) {
    if (!this._friendsOn()) return;
    const ids = this._spenderIds();
    const cfg = this.state.config;
    const roleMap = this._roleMap();
    const team = this._teamPlayers();
    for (let i = 0; i < ids.length; i += 4) {
      await this._gate(signal);
      await Promise.all(ids.slice(i, i + 4).map(async sp => {
        const fr = await this.friendNet.fundsAndRoster(sp, signal).catch(error => { if (error?.name === 'AbortError') throw error; return null; });
        if (fr?.bench?.some(p => !R.tradeBlock(p) && R.classify(p, cfg, roleMap, team) === 'side')) this._spenderTodo.add(sp);
      }));
    }
    await this._flushSpenders(signal);
  }

  // Spenders with the TK for `need` (after the floor), richest first.
  async _spendersByTk(need = 0) {
    const floor = this.state.config.spenderMinTk || 0;
    const ids = this._spenderIds();
    ids.forEach(id => this._ensureAcc(id));
    // TK of 60 spenders is read at most every 2 minutes (each trade updates its own number)
    if (!this._spenderFundsAt || this.now() - this._spenderFundsAt > 2 * 60 * 1000 || ids.some(id => this.state.accounts[id].funds == null)) {
      await this._refreshFunds(ids);
      this._spenderFundsAt = this.now();
    }
    return R.sideOrder(ids.map(id => ({ id, funds: this.state.accounts[id].funds })))
      .filter(x => !Number.isFinite(x.funds) || x.funds - need >= floor).map(x => x.id);
  }

  // Main's Satılabilir / Stok go to the spenders (in the same trade their Kart / cheap players
  // come to main). A spender that cannot take part is passed over; what is left goes to the
  // sides the old way.
  async _mainToSpenders(signal) {
    if (!this._friendsOn()) return;
    const mainId = this.state.config.mainId;
    const main = this.conns.get(mainId);
    if (!main) return;
    const spenders = await this._spendersByTk();
    const roleMap = this._roleMap();
    for (const sp of spenders) {
      await this._gate(signal);
      if (this._busy(sp)) continue;
      const all = this._ours(mainId, R.rosterOf(await main.roster()), 'side');
      if (!all.length) return;
      const no = all.filter(p => !this._mayTake(sp, p, roleMap)).map(p => p.id);
      if (no.length) this.state.excluded[sp] = [...new Set([...(this.state.excluded[sp] || []), ...no])];
      const give = all.filter(p => !(this.state.excluded[sp] || []).includes(p.id));
      if (!give.length) continue;
      const cost = give.slice(0, R.TRADE_MAX).reduce((n, p) => n + R.salaryOf(p), 0);
      const known = this.state.accounts[sp].funds;
      if (Number.isFinite(known) && known - cost < (this.state.config.spenderMinTk || 0)) continue; // not opened for nothing
      const wasOpen = this.conns.has(sp);
      try {
        await this._open(sp, signal);
        this._ensureAcc(sp).role = 'spender';
        const funds = await this.conns.get(sp).funds().catch(() => null);
        if (Number.isFinite(funds) && funds - cost < (this.state.config.spenderMinTk || 0)) continue;
        if (!(await this._spenderRoom(sp, give.map(p => p.id), Math.min(give.length, R.TRADE_MAX), signal))) continue;
        this._log('info', 'at2.toSpender', { from: this._name(mainId), name: this._name(sp), count: Math.min(give.length, R.TRADE_MAX) }, `${this._name(mainId)} → ${this._name(sp)} (Harcayıcı)`, sp);
        const r = await this._tradeWithMain(sp, signal);
        this._spenderTodo.add(sp);
        if (r?.skipped) continue;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        this._log('warning', 'at2.spenderTradeFailed', { name: this._name(sp), error: error.message }, `${this._name(sp)}: ${error.message}`, sp);
      } finally {
        if (!wasOpen) this._park(sp);
      }
    }
  }

  // At the end of a side's turn the Satılabilir / Stok players it kept go to a spender
  // (the spender pays their salary). None can → the side keeps them, like before.
  async _sideToSpender(sideId, signal) {
    if (!this._friendsOn() || this._accountRoleId(sideId) === 'spender') return;
    const side = this.conns.get(sideId);
    const sideAcc = this._acc(sideId);
    for (let round = 0; round < MAX_TRADE_ROUNDS; round++) {
      await this._gate(signal);
      const kept = this._ours(sideId, R.rosterOf(await side.roster()), 'side').filter(p => sideAcc.players[p.id]?.status === 'keep');
      if (!kept.length) return;
      const roleMap = this._roleMap();
      const floor = this.state.config.spenderMinTk || 0;
      let give = [];
      const sp = (await this._spendersByTk()).find(id => {
        if (id === sideId || this._busy(id)) return false;
        give = kept.filter(p => this._mayTake(id, p, roleMap) && !(this.state.excluded[id] || []).includes(p.id)).slice(0, R.TRADE_MAX);
        const funds = this.state.accounts[id].funds;
        return give.length && (!Number.isFinite(funds) || funds - give.reduce((n, p) => n + R.salaryOf(p), 0) >= floor);
      });
      if (!sp) { this._log('info', 'at2.noSpender', { name: this._name(sideId) }, `${this._name(sideId)}: no Harcayıcı with enough TK · it keeps its players`, sideId); return; }
      const wasOpen = this.conns.has(sp);
      try {
        await this._open(sp, signal);
        this._ensureAcc(sp).role = 'spender';
        if (!(await this._spenderRoom(sp, give.map(p => p.id), give.length, signal))) { (this.state.excluded[sp] ||= []).push(...give.map(p => p.id)); continue; }
        const ok = await this._tradePair(sideId, sp, give, signal);
        if (!ok) (this.state.excluded[sp] ||= []).push(...give.map(p => p.id));
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        this._log('warning', 'at2.spenderTradeFailed', { name: this._name(sp), error: error.message }, `${this._name(sp)}: ${error.message}`, sp);
        (this.state.excluded[sp] ||= []).push(...give.map(p => p.id));
      } finally {
        if (!wasOpen) this._park(sp);
      }
    }
  }

  // One trade: `hostId` gives `give`, `guestId` gives nothing and pays their salary.
  async _tradePair(hostId, guestId, give, signal) {
    const host = this.conns.get(hostId), guest = this.conns.get(guestId);
    const hostRoster = R.rosterOf(await host.roster()), guestRoster = R.rosterOf(await guest.roster());
    const guestFunds = await guest.funds().catch(() => this._acc(guestId).funds);
    const plan = R.planTrade({ mainRoster: guestRoster, sideRoster: hostRoster, mainGive: [], sideGive: give, mainFunds: guestFunds, sideFunds: Infinity });
    if (plan.empty || !plan.mainCanPay) return false;
    this._log('info', 'at2.toSpender', { from: this._name(hostId), name: this._name(guestId), count: plan.sideGives.length }, `${this._name(hostId)} → ${this._name(guestId)} (Harcayıcı)`, guestId);
    const result = await this._executeTrade(hostId, plan, signal, guestId);
    if (!result.success) { this._log('warning', 'at2.tradeFailed', { side: this._name(guestId), error: result.message }, `Trade with ${this._name(guestId)} failed: ${result.message}`, guestId); return false; }
    const h = this._acc(hostId), g = this._ensureAcc(guestId);
    for (const p of plan.sideGives) {
      const row = h.players[p.id];
      delete h.players[p.id];
      g.players[p.id] = { ...row, status: 'keep', from: h.name };
    }
    this._spenderTodo.add(guestId);
    h.tradesOut += plan.sideGives.length; g.tradesIn += plan.sideGives.length;
    h.tkReceived += plan.tk; g.tkPaid += plan.tk;
    g.funds = Number.isFinite(g.funds) ? g.funds - plan.tk : g.funds;
    h.funds = Number.isFinite(h.funds) ? h.funds + plan.tk : h.funds;
    this._tick('trade');
    this._log('success', 'at2.spenderTraded', { from: h.name, name: g.name, count: plan.sideGives.length, tk: plan.tk }, `${h.name} gave ${plan.sideGives.length} player(s) to ${g.name} · ${plan.tk} TK`, guestId);
    this._save();
    return true;
  }

  // After its own Scout an account looks at its friends' boards (Main's own board is its turn):
  // Kart / cheap players go to Main when Main can reach that board, otherwise to this account
  // (the old way, then a trade); Satılabilir / Stok go to a spender, or the side keeps them when
  // none can take them. Main does not keep Satılabilir from friends.
  async _friendBoards(id, role, signal) {
    if (!this._friendsOn()) return;
    const mainId = this.state.config.mainId;
    const mainUser = this._userIdOf(mainId);
    const roleMap = this._roleMap();
    const roleNames = this._roleNames();
    let friends;
    try { friends = await this.friendNet.friendsOf(id, { signal }); }
    catch (error) { if (error?.name === 'AbortError') throw error; this._log('warning', 'at2.friendsFailed', { name: this._name(id), error: error.message }, `${this._name(id)}: friend list could not be read`, id); return; }
    const mainFriends = role === 'main' ? friends : await this.friendNet.friendsOf(mainId, { signal }).catch(() => null);
    const seen = (this._boardSeen ||= new Map());
    // a board is read again after its own refresh (every 30 min); one with something left on it
    // after 10 minutes (user 2026-11-07: the same boards were read over and over)
    const owners = [...friends.ids].filter(u => u !== mainUser && (seen.get(u) || 0) <= this.now());
    owners.forEach(u => seen.set(u, this.now() + 10 * 60 * 1000));
    // the boards are read 4 at a time (one round trip each); signing stays one by one
    const boards = new Map();
    const read = async u => { try { boards.set(u, await this.friendNet.board(id, u, signal)); } catch (error) { if (error?.name === 'AbortError') throw error; } };
    for (let i = 0; i < owners.length; i += 4) {
      await this._gate(signal);
      await Promise.all(owners.slice(i, i + 4).map(read));
    }
    for (const ownerUser of owners) {
      await this._gate(signal);
      const board = boards.get(ownerUser);
      if (!board) continue;
      const untilRefresh = () => { if (board.refreshesIn > 0) seen.set(ownerUser, this.now() + board.refreshesIn * 1000); };
      if (!board.freeAgents.some(a => !a.isSigned && R.classify(a, this.state.config, roleMap))) { untilRefresh(); continue; }
      const ownerName = friends.names.get(ownerUser) || '?';
      const done = new Set();
      for (const agent of board.freeAgents) {
        await this._gate(signal);
        if (agent.isSigned) continue;
        const base = R.classify(agent, this.state.config, roleMap);
        if (base === 'side' && this._ownSpenderTakes(ownerUser, agent, roleMap)) {
          this._log('info', 'at2.leftForSpender', { player: agent.name, owner: ownerName }, `${agent.name} is left on ${ownerName}'s Scout · that Harcayıcı signs it in its own turn`, id);
          done.add(agent.id);
          continue;
        }
        if (base === 'side' && this._needsLv30(agent, roleMap)) {
          const r = await this._stokBuy(ownerUser, agent, signal, id);
          if (r === 'done' || (r === 'self' && await this._friendSign(id, role, ownerUser, ownerName, agent, roleMap, roleNames, signal))) done.add(agent.id);
          continue;
        }
        if (base === 'side') {
          const sp = await this._spenderFor(ownerUser, agent, signal, id);
          if (sp && await this._spenderBuy(sp, ownerUser, agent, signal)) { done.add(agent.id); continue; }
          // nobody else can: main (all its friends' boards) or the side signs it and hands it
          // to a Harcayıcı by trade later
          if (await this._friendSign(id, role, ownerUser, ownerName, agent, roleMap, roleNames, signal)) done.add(agent.id);
          continue;
        }
        if (base !== 'main') continue;
        const viaMain = role === 'main' || Boolean(mainFriends?.ids?.has(ownerUser));
        const ok = viaMain
          ? await this._mainLock.run(() => this._friendSign(mainId, 'main', ownerUser, ownerName, agent, roleMap, roleNames, signal))
          : await this._friendSign(id, role, ownerUser, ownerName, agent, roleMap, roleNames, signal);
        if (ok) done.add(agent.id);
      }
      if (!board.freeAgents.some(a => !a.isSigned && !done.has(a.id) && R.classify(a, this.state.config, roleMap))) untilRefresh();
    }
  }

  // `buyerId` (main or the side in its turn, both connected) signs a friend's board player
  // under its own rules, like its own Scout.
  async _friendSign(buyerId, role, ownerUser, ownerName, agent, roleMap, roleNames, signal) {
    if (this._blocked(buyerId)) return false;
    if (this._level(buyerId) < 30 && this._needsLv30(agent, roleMap)) return false; // Stok / Lv30+ only
    const rule = role === 'main' ? null : this._ruleFor(buyerId);
    const cfg = R.configFor(this.state.config, rule);
    const dir = R.classify(agent, cfg, roleMap);
    if (!dir || dir === 'ask' || !R.accountAllows(rule, R.signReason(agent, cfg, roleMap), agent, roleMap, cfg)) return false;
    // a side signing for main off a friend's board: the same budget as its own Scout (user 2026-11-07)
    if (role !== 'main' && dir === 'main' && !this._mainPays(Number(agent.baseSalary) || 0, agent.name, buyerId, true)) return false;
    const acc = this._acc(buyerId) || this._ensureAcc(buyerId);
    const conn = this.conns.get(buyerId) || await this._open(buyerId, signal);
    let roster = R.rosterOf(await conn.roster());
    if (roster.ids.has(agent.id)) return false;
    if (roster.total >= R.ROSTER_MAX) {
      if (!(await this._makeRoom(buyerId, role, signal))) return false;
      roster = R.rosterOf(await conn.roster());
      if (roster.total >= R.ROSTER_MAX) return false;
    }
    const price = Number(agent.baseSalary) || 0;
    // TK is tracked; it is read again only when the tracked number says it is not enough
    if (!Number.isFinite(acc.funds) || acc.funds < price) acc.funds = await conn.funds().catch(() => acc.funds);
    if (Number.isFinite(acc.funds) && acc.funds < price) return false;
    this._step('signing', { name: this._name(buyerId), player: agent.name, price }, buyerId);
    const r = await this.friendNet.signFrom(buyerId, ownerUser, agent.id, signal);
    if (!r?.success) {
      const m = String(r?.message || r?.error || 'refused');
      if (/limit|daily|today|maximum|too many/i.test(m)) this._block(buyerId, m);
      else if (!/not available|already signed/i.test(m)) this._log('warning', 'at2.signFailed', { player: agent.name, error: m }, `${agent.name} could not be signed`, buyerId);
      return false;
    }
    // the reply says whether the salary was cut (Lv30+, 5%); no second roster read
    const signedAs = r.revealedPlayer && r.revealedPlayer.id === agent.id ? r.revealedPlayer : null;
    const salary = Number(signedAs?.signedSalary) || (r.salaryCut ? Math.round(price * 0.95) : price);
    const row = this._row({ ...agent, ...(signedAs || {}), signedSalary: salary }, cfg, roleMap, roleNames, { from: ownerName });
    row.status = row.dir ? this._statusFor(row.dir, role) : 'none';
    row.discounted = salary < price;
    acc.players[agent.id] = row;
    acc.bought += 1;
    acc.spent += salary; // paid = salary, discount included
    if (Number.isFinite(acc.funds)) acc.funds -= salary;
    this._log('success', 'at2.friendSigned', { name: this._name(buyerId), player: agent.name, price: salary, owner: ownerName }, `${this._name(buyerId)} signed ${agent.name} off ${ownerName}'s board · ${salary} TK`, buyerId);
    this._save();
    await sleep(this.timing.stepMs, signal);
    return true;
  }

  // A full roster: main converts or unloads to sides; a side gives to main or lists.
  async _makeRoom(id, role, signal) {
    if (role === 'main') {
      if (await this._convertMain(signal)) return true;
      // Satılabilir / Stok fill main: a Harcayıcı takes them first, the sides only after
      await this._mainToSpenders(signal);
      const main = this.conns.get(this.state.config.mainId);
      if (main && R.rosterOf(await main.roster()).total < R.ROSTER_MAX) return true;
      return this._unloadMain(signal);
    }
    // A full side holding more Satılabilir / Stok than main-bound players hands them to a
    // Harcayıcı first: one big trade instead of many 1-player trades with main (live 2026-11-05).
    if (this._friendsOn() && this._accountRoleId(id) !== 'spender') {
      const full = R.rosterOf(await this.conns.get(id).roster());
      const toMain = this._ours(id, full, 'main').length;
      const toSpender = this._ours(id, full, 'side').filter(p => this._acc(id).players[p.id]?.status === 'keep').length;
      if (toSpender > toMain) {
        await this._sideToSpender(id, signal);
        if (R.rosterOf(await this.conns.get(id).roster()).total < R.ROSTER_MAX) return true;
      }
    }
    const r = await this._tradeWithMain(id, signal);
    if (r?.skipped) return false;
    let roster = R.rosterOf(await this.conns.get(id).roster());
    if (roster.total < R.ROSTER_MAX) return true;
    // A Harcayıcı running as a side keeps its Satılabilir / Stok: its roster never fills, a few
    // bench players go to the market at their default price (nobody is asked, the run goes on).
    if (this._friendsOn() && this._accountRoleId(id) === 'spender') {
      if (await this._spenderRoom(id, [], 3, signal)) return true;
    }
    // still full of Satılabilir / Stok: they go to a Harcayıcı before anything is listed
    await this._sideToSpender(id, signal);
    roster = R.rosterOf(await this.conns.get(id).roster());
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
    this._tick('convert');
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
    const sides = s.config.accountIds.filter(id => id !== mainId && !s.sidesSkipped.includes(id) && !this._busy(id));
    await this._refreshFunds(sides);
    for (const side of R.sideOrder(sides.map(id => ({ id, funds: this._acc(id).funds }))).map(x => x.id)) {
      await this._gate(signal);
      const wasOpen = this.conns.has(side);
      await this._open(side, signal);
      this._log('info', 'at2.unload', { name: this._name(side) }, `Main is full · giving players to ${this._name(side)}`, side);
      await this._tradeWithMain(side, signal, { unload: true });
      if (!wasOpen && !this._busy(side)) this._close(side);
      const roster = R.rosterOf(await this.conns.get(mainId).roster());
      if (roster.total < R.ROSTER_MAX) return true;
    }
    throw new UserFixError('Main is full and no side could take its players.', 'at2.mainFull', { name: this._name(mainId) });
  }

  // Trades between main (guest) and one side (host) until nothing more can move.
  async _tradeWithMain(sideId, signal, { unload = false, settle = false } = {}) {
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
      if (!plan.mainCanPay) {
        // main takes as many as its TK pays for; the rest waits on the side (no stop)
        const mainGets = plan.mainGives.reduce((n, p) => n + R.salaryOf(p), 0);
        const afford = [];
        let cost = 0;
        for (const p of plan.sideGives) { if (cost + R.salaryOf(p) - mainGets <= mainFunds) { afford.push(p); cost += R.salaryOf(p); } }
        const waiting = plan.sideGives.filter(p => !afford.includes(p));
        this._log('warning', 'at2.mainFundsWait', { main: this._name(mainId), funds: mainFunds, side: this._name(sideId), names: waiting.map(p => p.name).join(', ') }, `${this._name(mainId)} has ${mainFunds} TK · ${waiting.map(p => p.name).join(', ')} wait on ${this._name(sideId)}`, sideId);
        if (!afford.length && !plan.mainGives.length) { if (settle) return { waiting: waiting.map(p => p.id) }; if ((Number(mainFunds) || 0) < MAIN_TK_FLOOR) throw this._outOfTk(); return {}; }
        // in the run: main's TK at its end stops it (user 2026-11-07); one big player it cannot
        // pay while it still has TK waits, like before
        const stopOrWait = () => { if (settle) return { waiting: waiting.map(p => p.id) }; if ((Number(this._acc(mainId).funds) || 0) < MAIN_TK_FLOOR) throw this._outOfTk(); return {}; };
        const small = R.planTrade({ mainRoster, sideRoster, mainGive: plan.mainGives, sideGive: afford, mainFunds, sideFunds });
        if (small.empty || !small.mainCanPay || !small.sideCanPay) return stopOrWait();
        const res = await this._executeTrade(sideId, small, signal);
        if (res.success) { this._afterTrade(sideId, small); this._tick('trade'); if (small.sideGives.length) await this._convertMain(signal); }
        else this._log('warning', 'at2.tradeFailed', { side: this._name(sideId), error: res.message }, `Trade with ${this._name(sideId)} failed: ${res.message}`, sideId);
        // the stop's wrap-up fires what main cannot pay
        return stopOrWait();
      }
      if (!plan.sideCanPay) {
        this._log('warning', 'at2.sideFunds', { name: this._name(sideId), funds: sideFunds, need: -plan.tk }, `${this._name(sideId)}: not enough TK for the trade, account skipped`, sideId);
        return { skipped: true };
      }
      const result = await this._executeTrade(sideId, plan, signal);
      if (result.success) {
        this._afterTrade(sideId, plan);
        this._tick('trade');
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

  async _executeTrade(sideId, plan, signal, guestId = null) {
    const s = this.state;
    const mainId = guestId || s.config.mainId;
    const main = this.conns.get(mainId);
    const side = this.conns.get(sideId);
    const password = this.credentials.decryptSecret(s.config.roomPasswordEncrypted);
    const before = new Map([...plan.mainGives.map(p => [`g:${p.id}`, this._acc(mainId).players[p.id]?.status]), ...plan.sideGives.map(p => [`h:${p.id}`, this._acc(sideId).players[p.id]?.status])]);
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
      for (const p of plan.mainGives) if (this._acc(mainId).players[p.id]?.status === 'trading') this._acc(mainId).players[p.id].status = before.get(`g:${p.id}`) || 'toTrade';
      for (const p of plan.sideGives) if (this._acc(sideId).players[p.id]?.status === 'trading') this._acc(sideId).players[p.id].status = before.get(`h:${p.id}`) || 'toTrade';
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
    // the TK moves at once (the last trade of a turn is not followed by a fresh read)
    if (Number.isFinite(main.funds)) main.funds -= plan.tk;
    if (Number.isFinite(side.funds)) side.funds += plan.tk;
    this._log('success', 'at2.traded', { side: side.name, give: plan.mainGives.length, take: plan.sideGives.length, tk: plan.tk }, `Trade with ${side.name}: main gave ${plan.mainGives.length}, got ${plan.sideGives.length} · ${plan.tk} TK`, sideId);
    this._save();
  }

  // A signed player with roles both ways: Auto Trade waits for the user's choice. The answer
  // counts for the same player for the rest of the run.
  async _askRole(id, row, signal) {
    this.roleAnswers ||= new Map();
    if (this.roleAnswers.has(row.id)) return this.roleAnswers.get(row.id);
    const acc = this._acc(id);
    this.state.roleRequest = { accountId: id, name: acc.name, player: { id: row.id, name: row.name, salary: row.salary, price: row.price, base: row.base, roles: row.roles } };
    const before = this.state.status;
    this.state.status = 'awaitingRole';
    this._save();
    this._log('info', 'at2.askRole', { player: row.name, roles: (row.roles || []).join(', ') }, `${row.name} has roles both ways (${(row.roles || []).join(', ')}) · waiting for your choice`, id);
    this.onAttention?.('roleAsk', `${row.name} · ${acc.name}`);
    const dir = await new Promise(resolve => { this.roleWaiter = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
    this.state.roleRequest = null;
    this.state.status = before === 'awaitingRole' ? 'running' : before;
    this._save();
    if (signal.aborted) throw abortError();
    this.roleAnswers.set(row.id, dir);
    this._log('info', 'at2.roleChosen', { player: row.name, dir: dir || 'none' }, `${row.name} → ${dir === 'main' ? 'cards' : dir === 'side' ? 'Satılabilir' : 'left alone'}`, id);
    return dir;
  }

  // A side full of players it keeps: ask the user which to list on the market.
  async _askListing(id, roster, signal) {
    const acc = this._acc(id);
    // a player put on hold (Beklet) is not asked about again
    const players = this._ours(id, roster, 'side').filter(p => !acc.players[p.id]?.held).map(p => {
      const row = acc.players[p.id];
      // the Otomatik Fiyatlandırma price is filled in; the user can still change it
      const { price, currency } = this._listPrice(p, id);
      return { id: p.id, name: row.name, salary: row.salary, value: row.price, base: row.base ?? (Number(p.newBaseSalary) || null), roles: row.roles, price, currency };
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
    // each player: list (at its price) · fire · hold (stays on the side, shown in "List on
    // market" under the page). An item without an action is a listing (older pages).
    const toList = items.filter(it => !it.action || it.action === 'list');
    const toFire = items.filter(it => it.action === 'fire');
    for (const it of items.filter(it => it.action === 'hold')) {
      const row = acc.players[it.id];
      if (row) { row.held = true; this._log('info', 'at2.held', { name: row.name }, `${row.name} kept on the side (Beklet)`, id); }
    }
    if (toList.length) await this._list(id, toList, signal);
    const conn = this.conns.get(id);
    for (const it of toFire) {
      await this._gate(signal);
      const row = acc.players[it.id];
      const r = await conn.fire(it.id).catch(error => ({ success: false, message: error.message }));
      if (r?.success && row) row.status = 'fired';
      this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.fired' : 'at2.fireFailed', { name: row?.name || it.id, error: r?.error || r?.message || '' }, r?.success ? `${row?.name || it.id} fired` : `${row?.name || it.id} could not be fired: ${r?.error || r?.message || ''}`, id);
      this._save();
    }
    return R.rosterOf(await conn.roster()).total < R.ROSTER_MAX;
  }

  async _list(id, items, signal, { userAsked = false } = {}) {
    const conn = this.conns.get(id);
    const acc = this._acc(id);
    for (const it of items) {
      // asked by the user from "List on market": a paused run does not hold it back
      if (userAsked) { if (signal.aborted) throw abortError(); } else await this._gate(signal);
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
      await this._list(accountId, items, signal, { userAsked: true });
      await this._restoreParked(accountId, signal).catch(error => this._log('error', 'os.restoreFailed', { name: this._name(accountId), error: error.message }, error.message, accountId));
    } finally {
      if (temp) this._close(accountId);
      if (prev) Object.assign(this.state, prev);
      this._log(acc.listed - before === items.length ? 'success' : 'warning', 'at2.listDone', { name: this._name(accountId), listed: acc.listed - before, total: items.length }, `Market listing finished · ${this._name(accountId)} · ${acc.listed - before}/${items.length}`, accountId);
      this._save();
    }
    return this.snapshot();
  }

  // One player left on a side, fired from its row in "List on market" (the user confirms
  // in the page first). The row leaves the list.
  async firePlayer(accountId, playerId) {
    return this.firePlayers(accountId, [playerId]);
  }

  // "Fire all" of one side's list: one connection, the players one by one. A refusal stops
  // nothing; the error of the last refusal is thrown at the end.
  async firePlayers(accountId, playerIds) {
    const rows = (playerIds || []).map(id => [id, this.state?.accounts?.[accountId]?.players?.[id]]).filter(([, row]) => row);
    if (!rows.length) throw new Error('Player not found.');
    const signal = this.controller?.signal || new AbortController().signal;
    const temp = !this.conns.has(accountId);
    let failed = null;
    try {
      const conn = temp ? await this._open(accountId, signal) : this.conns.get(accountId);
      for (const [id, row] of rows) {
        const r = await conn.fire(id);
        this._log(r?.success ? 'success' : 'warning', r?.success ? 'at2.fired' : 'at2.fireFailed', { name: row.name, error: r?.error || r?.message || '' }, r?.success ? `${row.name} fired` : `${row.name} could not be fired: ${r?.error || r?.message || ''}`, accountId);
        if (r?.success) row.status = 'fired';
        else failed = r?.error || r?.message || 'Fire refused';
      }
      if (failed) throw new Error(failed);
    } finally {
      if (temp) this._close(accountId);
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
