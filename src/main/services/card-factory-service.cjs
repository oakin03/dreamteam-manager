const crypto = require('crypto');
const { GameSocket } = require('./game-socket.cjs');
const { TradeGameAccount, sleep, abortError } = require('./trade-game-client.cjs');
const R = require('./trade-rules.cjs');

// Kart Fabrikası (user 2026-11-24): a target account gets N cheap players (Scout price ≤ max TK)
// from side accounts, and every one of them becomes a star card there. Nothing else: no
// Satılabilir, no Stok, no card roles.
// - Every account of the run scouts: its own board (free callbacks only, never Callback items),
//   its friends' boards, and, when it has room left, boards of our other accounts it befriends.
// - Sides sign into their own roster; a full roster (or a finished turn) trades to the target,
//   one trade room at a time on the target. The target signs into its own roster too.
// - The target turns the factory players into cards a full bench at a time (the game refuses Make
//   for ~2 minutes after ~10 calls in a minute).
// - The count goes on across runs ("continue where you left": 34567 → on to the goal). Before a
//   start the target's TK must cover the rest at the max price, else it does not start.
// Only the players this service signed are ever traded or made into cards.

const ROSTER_MAX = 11;
const TRADE_MAX = 5;            // players one side gives in one trade
const MAKE_PER_MIN = 8;
const PARALLEL_MAX = 20;
const PARALLEL_DEFAULT = 10;
const TURN_GAP_MS = 10 * 60 * 1000;   // an exhausted account looks again at the latest after this
const FRIEND_SEEN_MS = 10 * 60 * 1000; // a friend's board read empty is read again after this
const BEFRIEND_PER_TURN = 2;
const FRIEND_LIMIT = 49;               // one friend place stays free
const OUR_BOARDS_TTL_MS = 60 * 1000;
const ACCEPT_WAIT_MS = 7000;
const ACCEPT_TRIES = 3;
const MAX_TRADE_ROUNDS = 12;

class FactoryStop extends Error { constructor(message, code, params) { super(message); this.code = code; this.params = params || {}; this.factoryStop = true; } }

class Lock {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) { const p = this.tail.then(fn, fn); this.tail = p.catch(() => {}); return p; }
}

const sameIds = (a, b) => (a || []).map(p => p.id).sort().join(',') === (b || []).map(p => p.id).sort().join(',');

class CardFactoryService {
  constructor({ store, activity, sessions, createSocket, friendNet = null, pauseAccount = null, usedElsewhere = () => false, gameHealth = null, onChanged, now = () => Date.now(), timing = {} }) {
    Object.assign(this, { store, activity, sessions, createSocket, friendNet, pauseAccount, usedElsewhere, gameHealth, now });
    this.timing = { stepMs: 250, idleMs: 30000, ...timing };
    this.revision = 0;
    this.onChanged = () => { this.revision++; onChanged?.(); };
    this.conns = new Map();      // accountId -> TradeGameAccount
    this.resumers = new Map();   // accountId -> resume()
    this.controller = null;
    this.targetLock = new Lock();
    this._makeTimes = [];
    const saved = this.store.getCardFactory?.() || {};
    this.data = { made: 0, holds: {}, targetHold: [], config: null, run: null, history: [], ...saved };
    if (this.data.run && ['running', 'stopping'].includes(this.data.run.status)) { this.data.run.status = 'stopped'; this.data.run.message = 'interrupted'; }
  }

  // ---------- state ----------
  _save() { this.store.saveCardFactory?.(this.data); this.onChanged(); }
  _accounts() { return this.store.getAccounts(); }
  _name(id) { return this._accounts().find(a => a.id === id)?.name || id; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(level, code, params, message, accountId = null) {
    this.activity.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName: 'Kart Fabrikası', code: `cf.${code}`, params, message });
  }
  _row(id, patch) {
    const run = this.data.run;
    if (!run) return;
    run.accounts[id] = { ...(run.accounts[id] || { id, name: this._name(id), signed: 0, traded: 0, spent: 0, status: 'waiting' }), ...patch };
    this.onChanged();
  }
  usesAccount(id) { return Boolean(this.controller && this.data.run?.config && (this.data.run.config.targetId === id || this.data.run.config.sideIds.includes(id))); }
  isRunning() { return Boolean(this.controller); }

  _sideHeld() { return Object.values(this.data.holds || {}).reduce((n, l) => n + l.length, 0); }
  // made + on the target waiting for Make + on sides waiting for a trade
  _reserved() { return (this.data.made || 0) + (this.data.targetHold || []).length + this._sideHeld(); }
  _goal() { return this.data.run?.config?.goal || this.data.config?.goal || 0; }

  snapshot() {
    const d = this.data;
    const run = d.run ? JSON.parse(JSON.stringify(d.run)) : null;
    if (run) {
      const started = Date.parse(run.startedAt);
      const hours = run.status === 'running' && started ? (this.now() - started) / 3600000 : null;
      const madeThisRun = (d.made || 0) - (run.madeAtStart || 0);
      run.ratePerHour = hours > 0.02 ? Math.round(madeThisRun / hours) : null;
      run.etaHours = run.ratePerHour ? Math.max(0, (run.config.goal - (d.made || 0)) / run.ratePerHour) : null;
    }
    return { running: this.isRunning(), made: d.made || 0, onTarget: (d.targetHold || []).length, onSides: this._sideHeld(), config: d.config, run, history: (d.history || []).slice(-20) };
  }

  // ---------- config / start ----------
  _normalize(raw = {}) {
    const accounts = this._accounts();
    const has = id => accounts.some(a => a.id === id);
    const targetId = has(raw.targetId) ? raw.targetId : null;
    const sideIds = [...new Set(raw.sideIds || [])].filter(id => has(id) && id !== targetId);
    const maxPrice = Math.floor(Number(raw.maxPrice));
    const goal = Math.floor(Number(raw.goal));
    const parallel = Math.max(1, Math.min(PARALLEL_MAX, Math.floor(Number(raw.parallel) || PARALLEL_DEFAULT)));
    return { targetId, sideIds, maxPrice, goal, parallel };
  }

  saveConfig(raw = {}) {
    const cfg = this._normalize({ ...(this.data.config || {}), ...raw });
    this.data.config = cfg;
    this._save();
    return this.snapshot();
  }

  // TK the target needs for the rest: the players on sides at their salary, the ones still to sign
  // at the max price. Read without signing in.
  async tkCheck(raw = {}) {
    const cfg = this._normalize({ ...(this.data.config || {}), ...raw });
    if (!cfg.targetId) return { ok: false, code: 'cf.noTarget' };
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    let funds = null;
    try { funds = Number((await gs.call('getUserBasicInfo', { userId: this._userId(cfg.targetId) }, 'userBasicInfo', { timeoutMs: 15000 }))?.funds); } finally { try { gs.close(); } catch {} }
    const remaining = Math.max(0, cfg.goal - (this.data.made || 0) - (this.data.targetHold || []).length);
    const onSides = Object.values(this.data.holds || {}).flat();
    const sideCost = onSides.reduce((n, p) => n + (Number(p.salary) || 0), 0);
    const toSign = Math.max(0, remaining - onSides.length);
    const need = sideCost + toSign * cfg.maxPrice;
    const enough = Number.isFinite(funds) && funds >= need;
    const covers = Number.isFinite(funds) && cfg.maxPrice > 0 ? Math.max(0, Math.floor(Math.max(0, funds - sideCost) / cfg.maxPrice)) : 0;
    return { ok: enough, funds: Number.isFinite(funds) ? funds : null, need, remaining, covers, made: this.data.made || 0 };
  }

  // fresh: the count starts again at 0 (a new goal); else it goes on from what was made
  async start(raw = {}, { fresh = false } = {}) {
    if (this.controller) throw new Error('Kart Fabrikası is already running.');
    const cfg = this._normalize({ ...(this.data.config || {}), ...raw });
    if (!cfg.targetId) throw new Error('Choose the target account.');
    if (!cfg.sideIds.length) throw new Error('Choose at least one side account.');
    if (!(cfg.maxPrice >= 1)) throw new Error('Enter the max price.');
    if (!(cfg.goal >= 1)) throw new Error('Enter how many players.');
    const holding = Object.entries(this.data.holds || {}).filter(([id, l]) => l.length && id !== cfg.targetId && !cfg.sideIds.includes(id) && this._accounts().some(a => a.id === id)).map(([id]) => id);
    if (holding.length) {
      cfg.sideIds = [...cfg.sideIds, ...holding];
      this._log('info', 'holdersAdded', { names: holding.map(id => this._name(id)).join(', ') }, `${holding.map(id => this._name(id)).join(', ')} still hold factory players · they join this run`);
    }
    for (const [id, l] of Object.entries(this.data.holds || {})) if (l.length && !this._accounts().some(a => a.id === id)) delete this.data.holds[id];
    const busy = [cfg.targetId, ...cfg.sideIds].filter(id => this.usedElsewhere(id));
    if (busy.length) throw new Error(`Auto Trade is using: ${busy.map(id => this._name(id)).join(', ')}`);
    if (fresh) { this.data.made = 0; }
    if ((this.data.made || 0) >= cfg.goal) throw new Error(`The goal (${cfg.goal}) is already reached: ${this.data.made} made.`);
    const tk = await this.tkCheck(cfg);
    if (!tk.ok) {
      this._log('error', 'tkShort', { funds: tk.funds ?? '?', need: tk.need, covers: tk.covers }, `Not started · the target has ${tk.funds ?? '?'} TK, the rest needs up to ${tk.need} TK (enough for ~${tk.covers} players)`, cfg.targetId);
      return { ...this.snapshot(), tkShort: tk };
    }
    this.data.config = cfg;
    const accounts = {};
    for (const id of [cfg.targetId, ...cfg.sideIds]) accounts[id] = { id, name: this._name(id), role: id === cfg.targetId ? 'target' : 'side', signed: 0, traded: 0, spent: 0, status: 'waiting', readyAt: null, note: null };
    this.data.run = { id: crypto.randomUUID(), status: 'running', startedAt: new Date(this.now()).toISOString(), finishedAt: null, config: cfg, madeAtStart: this.data.made || 0, accounts, message: null, error: null, password: crypto.randomBytes(4).toString('hex') };
    this._log('info', 'start', { goal: cfg.goal, made: this.data.made || 0, sides: cfg.sideIds.length, price: cfg.maxPrice, parallel: cfg.parallel }, `Kart Fabrikası started · ${this.data.made || 0}/${cfg.goal} · ${cfg.sideIds.length} side(s), ${cfg.parallel} at once · max ${cfg.maxPrice} TK`, cfg.targetId);
    this._save();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.done = this._run(signal)
      .then(() => { this.data.run.status = 'done'; this._log('success', 'done', { made: this.data.made, goal: cfg.goal }, `Kart Fabrikası finished · ${this.data.made}/${cfg.goal} cards`, cfg.targetId); })
      .catch(error => {
        if (error?.name === 'AbortError') { this.data.run.status = 'stopped'; this._log('warning', 'stopped', { made: this.data.made }, `Kart Fabrikası stopped · ${this.data.made} made`); return; }
        this.data.run.status = 'error';
        this.data.run.error = { message: error.message, code: error.code || null, params: error.params || {} };
        this._log('error', error.code ? error.code.replace(/^cf\./, '') : 'failed', { ...(error.params || {}), error: error.message }, `Kart Fabrikası stopped: ${error.message}`, cfg.targetId);
      })
      .finally(async () => {
        await this._closeAll();
        this.data.run.finishedAt = new Date(this.now()).toISOString();
        (this.data.history ||= []).push({ at: this.data.run.finishedAt, status: this.data.run.status, made: this.data.made, madeThisRun: (this.data.made || 0) - (this.data.run.madeAtStart || 0) });
        this.controller = null;
        this._save();
      });
    return this.snapshot();
  }

  stop() { this.controller?.abort(); return this.snapshot(); }
  async shutdown() { this.controller?.abort(); await this.done?.catch(() => {}); }
  resetCount() { if (this.controller) throw new Error('Stop it first.'); this.data.made = 0; this._save(); return this.snapshot(); }

  // ---------- connections ----------
  async _open(id, signal) {
    if (this.conns.has(id)) return this.conns.get(id);
    const account = this._accounts().find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    if (this.pauseAccount && !this.resumers.has(id)) {
      const resume = await this.pauseAccount(id, 'Kart Fabrikası').catch(() => null);
      if (resume) this.resumers.set(id, resume);
    }
    const conn = await TradeGameAccount.open({ account, sessions: this.sessions, createSocket: this.createSocket, signal });
    conn.onWait = (event, sec, message) => this._log('warning', 'gameWait', { event, sec, error: message ? ' · ' + message : '' }, `The game asks to wait ${sec} s (${event})`, id);
    this.conns.set(id, conn);
    return conn;
  }
  _resume(id) { const r = this.resumers.get(id); if (!r) return; this.resumers.delete(id); Promise.resolve().then(r).catch(() => {}); }
  _close(id) { const c = this.conns.get(id); if (c) { try { c.close(); } catch {} this.conns.delete(id); } }
  async _closeAll() { for (const id of [...this.conns.keys()]) this._close(id); for (const id of [...this.resumers.keys()]) this._resume(id); this.friendNet?.closeAll?.(); }

  // ---------- the run ----------
  async _run(signal) {
    const cfg = this.data.run.config;
    const target = await this._open(cfg.targetId, signal);
    this._row(cfg.targetId, { status: 'open' });
    const ids = [cfg.targetId, ...cfg.sideIds];
    const busy = new Set();
    const readyAt = new Map(ids.map(id => [id, 0]));
    const finished = () => (this.data.made || 0) >= cfg.goal;
    // sides that still hold players from an earlier run go first
    const order = () => [...ids].sort((a, b) => ((this.data.holds[b] || []).length - (this.data.holds[a] || []).length) || (readyAt.get(a) - readyAt.get(b)));
    const worker = async () => {
      while (!finished()) {
        if (signal.aborted) throw abortError();
        if (this.gameHealth?.isDown()) await this.gameHealth.waitUp(signal);
        const now = this.now();
        let id;
        if (!this._canSign()) {
          // every missing card is already signed: the holders trade, then the last Make
          id = order().find(x => x !== cfg.targetId && !busy.has(x) && (this.data.holds[x] || []).length);
          if (!id) {
            if (!busy.size) { await this.targetLock.run(() => this._convert(signal, { all: true })); if (finished()) break; }
            await sleep(2000, signal);
            continue;
          }
        } else id = order().find(x => !busy.has(x) && readyAt.get(x) <= now);
        if (!id) {
          // nothing to do now: wait for the next board refresh (or for a running turn)
          const next = Math.min(...ids.filter(x => !busy.has(x)).map(x => readyAt.get(x)), now + this.timing.idleMs);
          this._step('waiting', { at: new Date(next).toISOString() });
          await sleep(Math.max(1000, Math.min(this.timing.idleMs, next - now)), signal);
          continue;
        }
        busy.add(id);
        try {
          const wait = id === cfg.targetId ? await this._targetTurn(signal) : await this._sideTurn(id, signal);
          readyAt.set(id, this.now() + (wait ?? TURN_GAP_MS));
        } catch (error) {
          if (error?.name === 'AbortError' || error?.factoryStop) throw error;
          this._log('warning', 'turnFailed', { error: error.message }, `Turn failed: ${error.message}`, id);
          this._row(id, { status: 'error', note: error.message });
          readyAt.set(id, this.now() + 2 * 60 * 1000);
          if (id !== cfg.targetId) this._close(id);
        } finally { busy.delete(id); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(cfg.parallel, ids.length) }, worker));
    // what is still on the target becomes cards
    await this.targetLock.run(() => this._convert(signal, { all: true }));
    void target;
  }

  _step(step, params = {}) { if (this.data.run) { this.data.run.step = step; this.data.run.stepParams = params; this.onChanged(); } }
  _canSign() { return this._reserved() < this._goal(); }

  // Signs the cheap players of one board into `id`'s roster. `signOne(agent)` does the signing
  // (own board or a friend's); `room()` makes room (trade / convert) when the roster is full.
  async _signBoard(id, agents, signOne, room, signal) {
    const cfg = this.data.run.config;
    const conn = this.conns.get(id);
    let roster = R.rosterOf(await conn.roster());
    let funds = await conn.funds().catch(() => null);
    let signed = 0;
    for (const a of agents) {
      if (signal.aborted) throw abortError();
      if (!this._canSign()) return { signed, goal: true };
      const price = Number(a.baseSalary) || 0;
      if (a.isSigned || !(price > 0) || price > cfg.maxPrice || roster.ids.has(a.id)) continue;
      if (roster.total >= ROSTER_MAX) {
        if (!(await room())) return { signed, full: true };
        roster = R.rosterOf(await conn.roster());
        if (roster.total >= ROSTER_MAX) return { signed, full: true };
        funds = await conn.funds().catch(() => funds);
      }
      if (Number.isFinite(funds) && funds < price) return { signed, noFunds: true };
      const r = await signOne(a).catch(error => { if (error?.name === 'AbortError') throw error; return { success: false, message: error.message }; });
      if (!r?.success) {
        const m = String(r?.message || r?.error || 'refused');
        if (/limit|daily|today|maximum|too many/i.test(m) && signOne.friend) return { signed, blocked: m };
        continue;
      }
      // a secret player shows who it was now
      const realId = r.revealedPlayer?.id || a.id;
      const name = r.revealedPlayer?.name || a.visualName || a.name || '?';
      const salary = Number(r.revealedPlayer?.signedSalary) || (r.salaryCut ? Math.round(price * 0.95) : price);
      if (id === cfg.targetId) this.data.targetHold.push(realId);
      else (this.data.holds[id] ||= []).push({ id: realId, name, salary });
      roster.total += 1; roster.ids.add(realId);
      if (Number.isFinite(funds)) funds -= salary;
      signed += 1;
      const row = this.data.run.accounts[id];
      this._row(id, { signed: (row?.signed || 0) + 1, spent: (row?.spent || 0) + salary });
      this._log('success', 'signed', { player: name, price: salary, from: signOne.ownerName || '' }, `${name} signed · ${salary} TK${signOne.ownerName ? ` · ${signOne.ownerName}'s Scout` : ''}`, id);
      this._save();
      await sleep(this.timing.stepMs, signal);
    }
    return { signed };
  }

  // own board: every list, then the free callbacks (never Callback items)
  async _ownBoard(id, room, signal) {
    const conn = this.conns.get(id);
    let cooldown = null;
    for (let round = 0; round < 10; round++) {
      let fa = await conn.freeAgents();
      if (fa?.cooldownEnds && fa.cooldownEnds <= this.now()) fa = await conn.freeAgents();
      cooldown = Number(fa?.cooldownEnds) || cooldown;
      const sign = a => conn.sign(a.id);
      const res = await this._signBoard(id, fa?.freeAgents || [], sign, room, signal);
      if (res.goal || res.full || res.noFunds) return { ...res, cooldown };
      if (!(fa?.attemptsLeft > 0) || !this._canSign()) break;
      const cb = await conn.callback();
      if (!cb?.success) break;
      this._log('info', 'callback', { left: Math.max(0, (fa.attemptsLeft || 1) - 1) }, 'Scout called back (free)', id);
    }
    return { cooldown };
  }

  // friends' boards (and, with room left, our other accounts' boards after a friendship)
  async _friendBoards(id, room, signal) {
    if (!this.friendNet || this._blockedToday(id)) return {};
    const seen = (this._seen ||= new Map());
    let friends;
    try { friends = await this.friendNet.friendsOf(id, { signal }); } catch (error) { if (error?.name === 'AbortError') throw error; return {}; }
    const me = this._userId(id);
    const runUsers = new Set([this.data.run.config.targetId, ...this.data.run.config.sideIds].map(x => this._userId(x)));
    const boardOf = async u => this.friendNet.board(id, u, signal).catch(error => { if (error?.name === 'AbortError') throw error; return null; });
    const work = async (u, ownerName) => {
      if (!this._canSign()) return { goal: true };
      if ((seen.get(`${id}:${u}`) || 0) > this.now()) return {};
      const b = await boardOf(u);
      if (!b) return {};
      const cheap = (b.freeAgents || []).filter(a => !a.isSigned && Number(a.baseSalary) > 0 && Number(a.baseSalary) <= this.data.run.config.maxPrice);
      if (!cheap.length) { seen.set(`${id}:${u}`, this.now() + Math.max(FRIEND_SEEN_MS, (Number(b.refreshesIn) || 0) * 1000)); return {}; }
      const sign = Object.assign(a => this.friendNet.signFrom(id, u, a.id, signal), { friend: true, ownerName });
      const res = await this._signBoard(id, cheap, sign, room, signal);
      if (res.blocked) { this._block(id, res.blocked); return res; }
      if (!res.full && !res.goal && !res.noFunds) seen.set(`${id}:${u}`, this.now() + FRIEND_SEEN_MS);
      return res;
    };
    // a run account's own board is signed by that account in its turn
    for (const u of friends.ids) {
      if (u === me || runUsers.has(u)) continue;
      const res = await work(u, friends.names?.get(u) || '?');
      if (res.goal || res.full || res.noFunds || res.blocked) return res;
    }
    // room left: our accounts outside the run with cheap players on their board become friends
    if ((friends.ids.size || 0) >= FRIEND_LIMIT) return {};
    const ours = await this._ourBoards();
    let added = 0;
    for (const [u, b] of ours) {
      if (added >= BEFRIEND_PER_TURN || !this._canSign()) break;
      if (u === me || runUsers.has(u) || friends.ids.has(u)) continue;
      if (!b.agents.some(a => !a.isSigned && Number(a.baseSalary) > 0 && Number(a.baseSalary) <= this.data.run.config.maxPrice)) continue;
      try { await this.friendNet._befriend(b.accId, id, signal); } catch (error) { if (error?.name === 'AbortError') throw error; continue; }
      added += 1;
      this._log('info', 'befriended', { name: this._name(b.accId) }, `${this._name(b.accId)} added as a friend to reach its Scout`, id);
      const res = await work(u, this._name(b.accId));
      if (res.goal || res.full || res.noFunds || res.blocked) return res;
    }
    return {};
  }

  // our accounts outside the run: their own boards, read without signing in (40 at a time)
  async _ourBoards() {
    const c = this._ourCache;
    if (c && this.now() - c.at < OUR_BOARDS_TTL_MS) return c.boards;
    const run = new Set([this.data.run.config.targetId, ...this.data.run.config.sideIds]);
    const accs = this._accounts().filter(a => !run.has(a.id)).map(a => [a.id, this._userId(a.id)]).filter(([, u]) => u);
    const boards = new Map();
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(40, accs.length) }, async () => {
        for (let k; (k = i++) < accs.length;) {
          const [accId, u] = accs[k];
          const r = await gs.ack('getFreeAgent', { userId: u }, { timeoutMs: 15000 }).catch(() => null);
          if (r?.freeAgents?.length) boards.set(u, { accId, agents: r.freeAgents });
        }
      }));
    } finally { try { gs.close(); } catch {} }
    this._ourCache = { at: this.now(), boards };
    return boards;
  }

  _dayKey() { return new Date(this.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
  _blockedToday(id) { return this.data.run?.blocked?.[id] === this._dayKey(); }
  _block(id, message) {
    (this.data.run.blocked ||= {})[id] = this._dayKey();
    this._log('warning', 'friendLimit', { error: message }, `Signing from friends refused for today · ${message}`, id);
  }

  async _sideTurn(id, signal) {
    this._row(id, { status: 'opening', note: null });
    await this._open(id, signal);
    try {
      // what this side still holds (an earlier turn / run): it must still be in its roster
      const conn = this.conns.get(id);
      const roster = R.rosterOf(await conn.roster());
      this.data.holds[id] = (this.data.holds[id] || []).filter(p => roster.ids.has(p.id));
      if ((this.data.holds[id] || []).length) await this._toTarget(id, signal);
      const room = () => this._toTarget(id, signal);
      this._row(id, { status: 'scouting' });
      const own = await this._ownBoard(id, room, signal);
      let res = own;
      if (!own.goal && !own.full && !own.noFunds) res = await this._friendBoards(id, room, signal);
      if ((this.data.holds[id] || []).length) await this._toTarget(id, signal);
      this._row(id, { status: 'waiting', note: res.noFunds ? 'noFunds' : res.full ? 'full' : null, lastAt: new Date(this.now()).toISOString() });
      if (res.full || res.noFunds) return TURN_GAP_MS * 3; // its own roster / TK: much later
      const cd = Number(own.cooldown);
      return cd > this.now() ? Math.min(TURN_GAP_MS, cd - this.now() + 2000) : TURN_GAP_MS;
    } finally { this._close(id); }
  }

  async _targetTurn(signal) {
    const id = this.data.run.config.targetId;
    return this.targetLock.run(async () => {
      this._row(id, { status: 'scouting' });
      const room = async () => (await this._convert(signal, { all: true })) > 0;
      const own = await this._ownBoard(id, room, signal);
      if (!own.goal && !own.full && !own.noFunds) await this._friendBoards(id, room, signal);
      await this._convert(signal, { whenFull: true });
      this._row(id, { status: 'open', lastAt: new Date(this.now()).toISOString() });
      const cd = Number(own.cooldown);
      return cd > this.now() ? Math.min(TURN_GAP_MS, cd - this.now() + 2000) : TURN_GAP_MS;
    });
  }

  // ---------- Make on the target ----------
  async _makeSlot(signal) {
    for (;;) {
      const now = this.now();
      while (this._makeTimes.length && now - this._makeTimes[0] >= 60000) this._makeTimes.shift();
      if (this._makeTimes.length < MAKE_PER_MIN) { this._makeTimes.push(now); return; }
      this._step('makeWait');
      await sleep(this._makeTimes[0] + 60000 - now + 250, signal);
    }
  }

  // the factory players on the target's bench become cards (`whenFull`: only with ≤1 free place).
  // Returns how many were made.
  async _convert(signal, { whenFull = false } = {}) {
    const id = this.data.run.config.targetId;
    const conn = this.conns.get(id);
    if (!conn) return 0;
    const roster = R.rosterOf(await conn.roster());
    const mine = new Set(this.data.targetHold || []);
    // only bench players can be made cards: one that left the bench (put in the lineup, traded,
    // fired by hand) no longer counts, so the run signs another
    const benchIds = new Set(roster.bench.map(p => p.id));
    this.data.targetHold = (this.data.targetHold || []).filter(pid => benchIds.has(pid));
    const list = roster.bench.filter(p => mine.has(p.id)).map(p => p.id);
    if (!list.length) return 0;
    if (whenFull && roster.total < ROSTER_MAX - 1) return 0;
    this._row(id, { status: 'converting' });
    await this._makeSlot(signal);
    const r = await conn.makeCards(list);
    if (!r?.success) {
      this._log('warning', 'makeFailed', { error: r?.message || r?.error || '' }, `Make failed: ${r?.message || r?.error || 'no answer'}`, id);
      return 0;
    }
    const n = Number(r.count) || list.length;
    this.data.made = (this.data.made || 0) + n;
    this.data.targetHold = this.data.targetHold.filter(pid => !list.includes(pid));
    this._log('success', 'made', { count: n, made: this.data.made, goal: this._goal() }, `${n} card(s) made · ${this.data.made}/${this._goal()}`, id);
    this._row(id, { status: 'open' });
    this._save();
    return n;
  }

  // ---------- side → target ----------
  async _toTarget(sideId, signal) {
    return this.targetLock.run(async () => {
      const cfg = this.data.run.config;
      const target = this.conns.get(cfg.targetId) || await this._open(cfg.targetId, signal);
      const side = this.conns.get(sideId);
      let moved = 0;
      let dupConverted = false;
      for (let round = 0; round < MAX_TRADE_ROUNDS; round++) {
        if (signal.aborted) throw abortError();
        const sideRoster = R.rosterOf(await side.roster());
        let tgt = R.rosterOf(await target.roster());
        const held = (this.data.holds[sideId] || []).filter(p => sideRoster.ids.has(p.id));
        this.data.holds[sideId] = held;
        if (!held.length) break;
        // the same player already on the target: a factory one becomes a card first; the user's own
        // copy there means this one can never go → it is fired on the side (≤ max price lost)
        const dup = held.filter(p => tgt.ids.has(p.id));
        if (dup.length) {
          if (!dupConverted && dup.some(p => (this.data.targetHold || []).includes(p.id))) { dupConverted = true; await this._convert(signal, { all: true }); continue; }
          for (const p of dup.filter(p => !(this.data.targetHold || []).includes(p.id))) {
            const f = await side.fire(p.id).catch(() => null);
            this._log(f?.success ? 'info' : 'warning', 'dupFired', { player: p.name }, f?.success ? `${p.name} is the target's own player too · fired on the side` : `${p.name} is the target's own player too and could not be fired`, sideId);
            this.data.holds[sideId] = this.data.holds[sideId].filter(x => x.id !== p.id);
          }
          continue;
        }
        if (tgt.total >= ROSTER_MAX) {
          if ((await this._convert(signal, { all: true })) === 0) throw new FactoryStop('The target roster is full of players that are not the factory\'s · make room there', 'cf.targetFull', {});
          tgt = R.rosterOf(await target.roster());
        }
        const roomLeft = ROSTER_MAX - tgt.total;
        let give = held.slice(0, Math.min(TRADE_MAX, roomLeft));
        const funds = await target.funds().catch(() => null);
        if (Number.isFinite(funds)) {
          const fit = [];
          let cost = 0;
          for (const p of give) if (cost + p.salary <= funds) { fit.push(p); cost += p.salary; }
          give = fit;
          if (!give.length) throw new FactoryStop(`The target has ${funds} TK · not enough for the next player`, 'cf.targetOutOfTk', { funds });
        }
        const players = give.map(p => sideRoster.starters.concat(sideRoster.bench).find(x => x.id === p.id)).filter(Boolean);
        this._row(sideId, { status: 'trading' });
        const res = await this._trade(sideId, players, signal);
        if (!res.success) {
          this._log('warning', 'tradeFailed', { error: res.message }, `Trade to the target failed: ${res.message}`, sideId);
          if (/duplicate/i.test(res.message) && !dupConverted) { dupConverted = true; await this._convert(signal, { all: true }); continue; }
          if (/exceed max player/i.test(res.message)) { await this._convert(signal, { all: true }); continue; }
          break;
        }
        const ids = new Set(give.map(p => p.id));
        this.data.holds[sideId] = this.data.holds[sideId].filter(p => !ids.has(p.id));
        this.data.targetHold.push(...give.map(p => p.id));
        const tk = give.reduce((n, p) => n + p.salary, 0);
        moved += give.length;
        const row = this.data.run.accounts[sideId];
        this._row(sideId, { traded: (row?.traded || 0) + give.length });
        this._log('success', 'traded', { count: give.length, tk }, `${give.length} player(s) to the target · ${tk} TK`, sideId);
        this._save();
        await this._convert(signal, { whenFull: true });
      }
      return moved > 0;
    });
  }

  // one trade room: the side is the host and gives `players`, the target joins and gives nothing
  async _trade(sideId, players, signal) {
    const cfg = this.data.run.config;
    const target = this.conns.get(cfg.targetId);
    const side = this.conns.get(sideId);
    const password = this.data.run.password;
    let roomId = null;
    try {
      roomId = await side.createRoom('Kart', password);
      const sideJoined = side.expect('joinedRoomData', d => d?.roomId === roomId);
      const room = await target.joinRoom(roomId, password);
      await sideJoined.catch(() => null);
      const sel = players.map(p => (room.hostPlayers || []).find(x => x.id === p.id));
      if (sel.some(x => !x)) return { success: false, message: 'A selected player is not offered in the trade room.' };
      const upd = target.expect('tradeSelectionUpdate', d => d?.roomId === roomId && sameIds(d.hostSelectedPlayers, sel));
      side.select(roomId, sel);
      await upd;
      await sleep(300, signal);
      for (let attempt = 1; ; attempt++) {
        const both = target.expect('acceptTradeUpdate', d => d?.hostAccepted && d?.guestAccepted, ACCEPT_WAIT_MS);
        side.accept(roomId);
        await sleep(250, signal);
        target.accept(roomId);
        try { await both; break; } catch (error) { if (attempt >= ACCEPT_TRIES) throw error; }
      }
      const resultP = target.expect('tradeResult', () => true);
      target.confirm(roomId, sel, []);
      const result = await resultP;
      if (result?.success) return { success: true };
      return { success: false, message: result?.message || 'refused' };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // no answer although the game may have made it: the rosters tell
      try {
        const tgt = R.rosterOf(await target.roster());
        const sd = R.rosterOf(await side.roster());
        if (players.every(p => tgt.ids.has(p.id) && !sd.ids.has(p.id))) return { success: true, landed: true };
      } catch {}
      return { success: false, message: error.message };
    } finally {
      if (roomId) side?.cancelRoom(roomId);
      target?.leave();
    }
  }
}

module.exports = { CardFactoryService, PARALLEL_MAX, PARALLEL_DEFAULT };
