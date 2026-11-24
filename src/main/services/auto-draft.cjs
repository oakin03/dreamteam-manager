// Automatic Draft (user 2026-11-24). Over the Draft service (rooms, joining, picking):
//  - a new room that fits a chosen account's level: ONE account joins first and sees the pool;
//  - the players with a role in the pool are counted, and as many more accounts join (4 role
//    players → 3 more), as long as the room has seats and the accounts fit its level;
//  - on each of our turns, after a random 3–5 s (no bot-like instant picks), the account picks by
//    the role priority (default Stok, Satılabilir, Kart, then any new role). Stok goes to Lv30+
//    accounts first (a lower account leaves it while a Lv30+ one of ours still has to pick);
//  - a room with no role player: the cheapest player at or under Auto Trade's cheap price is taken
//    and made into a card / fired (option), or nothing is picked;
//  - after the draft: card players → main → star cards; Satılabilir / Stok → a Harcayıcı that lists
//    them at Auto Trade's price (none free → the account lists them itself). Accounts Auto Trade is
//    working on wait; Auto Play over the cap waits for this (capRelief);
//  - it goes on until the chosen accounts have no draft attempts left (rooms have a 10-minute
//    cooldown after a draft ends).
const { GameSocket } = require('./game-socket.cjs');
const R = require('./trade-rules.cjs');
const { levelRange } = require('./draft-service.cjs');

const TICK_MS = 700;
const PICK_DELAY = [3000, 5000];
const JOIN_GAP = [900, 2200];
const ATTEMPTS_EVERY_MS = 60 * 1000;
const ROSTER_MAX = 11;
const ROOM_SIZE = 10;
const ACTION_RETRY_MS = 30 * 1000;
const rand = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));

class AutoDraftService {
  constructor({ store, activity, draft, createSocket, onChanged, isBusy = () => false, capRelief = () => {}, atConfig = () => ({}), now = () => Date.now() }) {
    Object.assign(this, { store, activity, draft, createSocket, isBusy, capRelief, atConfig, now });
    this.onChanged = onChanged || (() => {});
    this.run = null;
    this.timer = null;
    this.actions = null; // { toCards(accountId, ids), fire(accountId, ids), toSpender(accountId, spenderId, ids) } from main.cjs
    this.pending = [];   // post-draft work: { accountId, ids, kind: 'cards'|'fire'|'spender', tries }
    this.rosterCache = new Map();
  }

  setActions(actions) { this.actions = actions; }

  _accounts() { return this.store.getAccounts(); }
  _name(id) { return this._accounts().find(a => a.id === id)?.name || id; }
  _profile(id) { return this.store.getAccountProfile?.()?.accounts?.[id] || {}; }
  _level(id) { return Number(this._profile(id).level) || null; }
  _userId(id) { return this._profile(id).userId || null; }
  _log(level, code, params, message, accountId = null) {
    this.activity.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName: 'Auto Draft', code, params, message });
  }

  // ---------- settings ----------
  roles() { return this.store.getCardRoles?.() || []; }
  // the saved priority with every role that exists now (a new role is added at the end)
  config() {
    const saved = this.store.getSettings?.()?.autoDraft || {};
    const roles = this.roles();
    const stok = roles.filter(r => /^sto(k|ck)/i.test(String(r.name).trim())).map(r => r.id);
    const def = [...stok, 'sellable', 'card'].filter(id => roles.some(r => r.id === id));
    const order = (Array.isArray(saved.priority) && saved.priority.length ? saved.priority : def).filter(id => roles.some(r => r.id === id));
    for (const r of roles) if (!order.includes(r.id)) order.push(r.id);
    return {
      accountIds: Array.isArray(saved.accountIds) ? saved.accountIds : [],
      priority: order,
      fallback: ['card', 'fire', 'none'].includes(saved.fallback) ? saved.fallback : 'card',
      sideOnly: Boolean(saved.sideOnly)
    };
  }
  saveConfig(patch = {}) {
    const s = this.store.getSettings();
    const cur = this.config();
    const next = { ...cur, ...patch };
    this.store.saveSettings({ ...s, autoDraft: { accountIds: next.accountIds, priority: next.priority, fallback: next.fallback, sideOnly: next.sideOnly } });
    this.onChanged();
    return this.config();
  }

  snapshot() {
    return { running: Boolean(this.run && this.run.status === 'running'), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, config: this.config(), roles: this.roles().map(r => ({ id: r.id, name: r.name, color: r.color })), pending: this.pending.map(p => ({ accountId: p.accountId, name: this._name(p.accountId), kind: p.kind, count: p.ids.length })) };
  }

  worksWith(accountId) { return Boolean(this.run?.status === 'running' && (this.run.accountIds.includes(accountId) || this.pending.some(p => p.accountId === accountId))); }

  // ---------- run ----------
  async start(patch = {}) {
    if (this.run?.status === 'running') throw new Error('Auto Draft is already running.');
    const cfg = this.saveConfig(patch);
    const ids = cfg.accountIds.filter(id => this._accounts().some(a => a.id === id) && this._userId(id));
    if (!ids.length) throw new Error('Choose at least one account.');
    this.run = { status: 'running', startedAt: new Date(this.now()).toISOString(), accountIds: ids, rooms: {}, accounts: Object.fromEntries(ids.map(id => [id, { state: 'waiting', slot: null, picks: [] }])), picked: 0, attemptsAt: 0 };
    await this.draft.watch();
    this._log('info', 'ad.start', { count: ids.length }, `Auto Draft started · ${ids.length} account(s)`);
    this.onChanged();
    const loop = async () => {
      if (!this.run || this.run.status !== 'running') return;
      try { await this._tick(); } catch (error) { this._log('warning', 'ad.error', { error: error.message }, `Auto Draft: ${error.message}`); }
      if (this.run?.status === 'running') this.timer = setTimeout(loop, TICK_MS);
    };
    loop();
    return this.snapshot();
  }

  stop(reason = 'stopped') {
    if (!this.run || this.run.status !== 'running') return this.snapshot();
    clearTimeout(this.timer); this.timer = null;
    this.run.status = reason === 'done' ? 'done' : 'stopped';
    this.run.finishedAt = new Date(this.now()).toISOString();
    this.draft.unwatch();
    this._log(reason === 'done' ? 'success' : 'warning', reason === 'done' ? 'ad.done' : 'ad.stopped', { picked: this.run.picked }, reason === 'done' ? `Auto Draft finished · ${this.run.picked} player(s) picked` : 'Auto Draft stopped');
    this.onChanged();
    // what was picked is still handed on (cards / Harcayıcı) after a stop
    this._drain();
    return this.snapshot();
  }

  async _tick() {
    const run = this.run;
    // attempts are read from the game now and then (never counted here)
    if (this.now() - run.attemptsAt > ATTEMPTS_EVERY_MS) { run.attemptsAt = this.now(); await this.draft._refreshAttempts(run.accountIds).catch(() => {}); }
    await this._syncRooms();
    await this._turns();
    await this._openRooms();
    this._processPending();
    // done: nobody has attempts left and none of ours is still in a room
    const left = run.accountIds.filter(id => (this.draft.attempts[id]?.draftAttempts ?? 1) > 0);
    if (!left.length && !run.accountIds.some(id => this.draft.joined.has(id))) this.stop('done');
  }

  _attempts(id) { return this.draft.attempts[id]?.draftAttempts ?? 0; }
  _inSlot(id) {
    if (this.draft.joined.has(id)) return true;
    const uid = this._userId(id);
    return (this.draft.slots || []).some(s => (s.users || []).some(u => (typeof u === 'string' ? u : u?.userId) === uid));
  }
  _fits(id, slot) { const range = levelRange(slot); const lv = this._level(id); return Boolean(range && lv && lv >= range[0] && lv <= range[1]); }

  // the roster size, read without logging in (cached 60 s; a full roster cannot draft)
  async _rosterTotal(id) {
    const c = this.rosterCache.get(id);
    if (c && this.now() - c.at < 60000) return c.total;
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const r = await gs.ack('getTeamOptimized', { userId: this._userId(id) }, { timeoutMs: 10000 });
      const total = (r?.players?.starters || []).length + (r?.players?.bench || []).length;
      this.rosterCache.set(id, { total, at: this.now() });
      return total;
    } finally { try { gs.close(); } catch {} }
  }

  // free accounts for a room: chosen, attempts left, fit the level, in no room, not used by Auto
  // Trade, roster not full
  async _free(slot, n) {
    const out = [];
    for (const id of this.run.accountIds) {
      if (out.length >= n) break;
      if (this._attempts(id) <= 0 || this._inSlot(id) || this.isBusy(id) || !this._fits(id, slot)) continue;
      const total = await this._rosterTotal(id).catch(() => ROSTER_MAX);
      if (total >= ROSTER_MAX) { this.run.accounts[id].state = 'rosterFull'; continue; }
      out.push(id);
    }
    // Lv30+ first: they take the Stok players
    return out.sort((a, b) => (this._level(b) >= 30) - (this._level(a) >= 30));
  }

  // a new room (not started, no cooldown, seats left) for a level one of ours fits: one account joins
  async _openRooms() {
    for (const s of this.draft.slots || []) {
      const slot = s.slotNumber;
      if (this.run.rooms[slot] && !this.run.rooms[slot].ended) continue;
      if (s.hasStarted || s.cooldownRemaining > 0 || (s.users?.length || 0) >= ROOM_SIZE) continue;
      const [scout] = await this._free(slot, 1);
      if (!scout) continue;
      this.run.rooms[slot] = { slot, scout, ours: [scout], extrasDone: false, rolePlayers: null, ended: false, at: new Date(this.now()).toISOString() };
      this.run.accounts[scout] = { ...this.run.accounts[scout], state: 'joining', slot };
      this.onChanged();
      try {
        await this.draft.join(scout, slot);
        this.run.accounts[scout].state = 'inRoom';
        this._log('info', 'ad.joined', { slot }, `Joined draft room ${slot} first · looking at the players`, scout);
      } catch (error) {
        this.run.accounts[scout].state = 'waiting';
        delete this.run.rooms[slot];
        this._log('warning', 'ad.joinFailed', { slot, error: error.message }, `Could not join room ${slot}: ${error.message}`, scout);
      }
      return; // one room at a time
    }
  }

  // the room's pool is known after the first join: as many more accounts as there are role players
  _roleOf(player) {
    const map = R.roleMapFrom(this.store.getCardMetadata?.() || {});
    const roles = map.get(player.id) || [];
    const order = this.config().priority;
    const ranked = roles.filter(r => order.includes(r)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return ranked[0] || null;
  }
  _dirOf(role) {
    const at = this.atConfig() || {};
    const toMain = at.sideToMainRoleIds || ['card'];
    const toSide = at.mainToSideRoleIds || ['sellable'];
    if (toSide.includes(role) || /^sto(k|ck)/i.test(String(this.roles().find(r => r.id === role)?.name || ''))) return 'side';
    if (toMain.includes(role)) return 'main';
    return 'side';
  }
  _isStok(role) { return /^sto(k|ck)/i.test(String(this.roles().find(r => r.id === role)?.name || '').trim()); }
  _wanted(players) {
    const cfg = this.config();
    return (players || []).filter(p => !p.signed).map(p => ({ p, role: this._roleOf(p) }))
      .filter(x => x.role && !(cfg.sideOnly && this._dirOf(x.role) === 'main'));
  }

  async _syncRooms() {
    for (const room of Object.values(this.run.rooms)) {
      if (room.ended) continue;
      const live = this.draft.rooms.get(room.slot);
      if (!live) continue;
      if (live.ended) { await this._roomEnded(room); continue; }
      if (!room.extrasDone && (live.players || []).length) {
        room.extrasDone = true;
        const want = this._wanted(live.players).length;
        room.rolePlayers = want;
        const seats = ROOM_SIZE - Math.max((live.users || []).length, room.ours.length);
        const extra = Math.max(0, Math.min(want - 1, seats));
        this._log('info', 'ad.pool', { slot: room.slot, count: want, extra }, `Room ${room.slot}: ${want} player(s) with a role · ${extra} more account(s) join`, room.scout);
        if (!live.started && extra > 0) {
          const more = await this._free(room.slot, extra);
          for (const id of more) {
            if (live.started || this.run.status !== 'running') break;
            await sleep(rand(JOIN_GAP));
            this.run.accounts[id] = { ...this.run.accounts[id], state: 'joining', slot: room.slot };
            try { await this.draft.join(id, room.slot); room.ours.push(id); this.run.accounts[id].state = 'inRoom'; }
            catch (error) { this.run.accounts[id].state = 'waiting'; this._log('warning', 'ad.joinFailed', { slot: room.slot, error: error.message }, `Could not join room ${room.slot}: ${error.message}`, id); }
            this.onChanged();
          }
        }
      }
    }
  }

  // our account's turn: a random 3–5 s, then the best player for it
  async _turns() {
    for (const room of Object.values(this.run.rooms)) {
      if (room.ended) continue;
      const live = this.draft.rooms.get(room.slot);
      if (!live?.started || !live.turn?.userId) continue;
      const id = room.ours.find(a => this.draft.joined.get(a)?.userId === live.turn.userId);
      if (!id) continue;
      const key = `${room.slot}:${live.turn.index}`;
      if (room.scheduled === key) continue;
      room.scheduled = key;
      if ((live.picked || []).includes(id)) continue;
      const delay = rand(PICK_DELAY);
      this.run.accounts[id].state = 'picking';
      this.onChanged();
      setTimeout(() => this._pick(room, id).catch(error => this._log('warning', 'ad.pickFailed', { error: error.message }, `Pick failed: ${error.message}`, id)), delay);
    }
  }

  _choose(room, id, live) {
    const cfg = this.config();
    const wanted = this._wanted(live.players).sort((a, b) => (cfg.priority.indexOf(a.role) - cfg.priority.indexOf(b.role)) || ((Number(b.p.baseSalary) || 0) - (Number(a.p.baseSalary) || 0)));
    // Stok is left for a Lv30+ account of ours that still has to pick (it may get the 5% cut)
    const picked = new Set(live.picked || []);
    const lv30Left = room.ours.filter(a => a !== id && !picked.has(a) && this._level(a) >= 30).length;
    const stokLeft = wanted.filter(w => this._isStok(w.role)).length;
    const mine = this._level(id) >= 30 || stokLeft > lv30Left ? wanted : wanted.filter(w => !this._isStok(w.role));
    if (mine.length) return { player: mine[0].p, role: mine[0].role, kind: this._dirOf(mine[0].role) === 'main' ? 'cards' : 'spender' };
    if (cfg.fallback === 'none' || cfg.sideOnly || wanted.length) return null;
    const cheap = Number(this.atConfig()?.maxPrice) || 0;
    const pool = (live.players || []).filter(p => !p.signed && Number(p.baseSalary) > 0 && Number(p.baseSalary) <= cheap).sort((a, b) => Number(a.baseSalary) - Number(b.baseSalary));
    return pool[0] ? { player: pool[0], role: null, kind: cfg.fallback === 'fire' ? 'fire' : 'cards' } : null;
  }

  async _pick(room, id) {
    const live = this.draft.rooms.get(room.slot);
    if (!live || live.ended || this.run?.status !== 'running') return;
    if (this.draft.joined.get(id)?.userId !== live.turn?.userId) return; // the turn moved on
    let c = null;
    // the chosen player may be taken by someone else in the meantime: the next best one
    for (let attempt = 0; attempt < 3; attempt++) {
      c = this._choose(room, id, live);
      if (!c) break;
      try { await this.draft.pick(id, c.player.id); break; }
      catch (error) { if (attempt === 2 || !/already|signed|picked/i.test(error.message)) throw error; c = null; }
    }
    if (!c) { this.run.accounts[id].state = 'noPick'; this._log('info', 'ad.noPick', { slot: room.slot }, `Room ${room.slot}: nothing to pick for this account`, id); this.onChanged(); return; }
    this.draft.tagRows(id, { [c.player.id]: { role: c.role, auto: c.kind } });
    this.run.accounts[id].picks.push({ name: c.player.visualName || c.player.name, role: c.role, kind: c.kind, slot: room.slot });
    this.run.accounts[id].state = 'picked';
    this.run.picked += 1;
    this.rosterCache.delete(id);
    this.onChanged();
  }

  async _roomEnded(room) {
    room.ended = true;
    for (const id of room.ours) {
      if (this.run.accounts[id]) { this.run.accounts[id].state = 'waiting'; this.run.accounts[id].slot = null; }
      const rows = (this.draft.snapshot().drafted?.[id] || []).filter(r => r.auto && r.slot === room.slot);
      for (const kind of ['cards', 'spender', 'fire']) {
        const ids = rows.filter(r => r.auto === kind).map(r => r.id);
        if (ids.length) this.pending.push({ accountId: id, ids, kind, tries: 0, nextAt: 0 });
      }
    }
    this._log('info', 'ad.roomDone', { slot: room.slot }, `Room ${room.slot} is over · the picked players are handed on`);
    this.onChanged();
  }

  // ---------- after the draft ----------
  _drain() { this._processPending(); }
  _processPending() {
    if (this._working || !this.actions) return;
    const job = this.pending.find(p => p.nextAt <= this.now());
    if (!job) return;
    this._working = true;
    this._runJob(job).finally(() => { this._working = false; this.onChanged(); if (this.pending.length && !(this.run?.status === 'running')) setTimeout(() => this._processPending(), 1000); });
  }
  async _runJob(job) {
    const mainId = this.store.getAccountProfile?.()?.mainAccountId;
    try {
      if (job.kind === 'cards') {
        if (!mainId) throw new Error('No Main account is set.');
        await this.actions.toCards(job.accountId, job.ids);
      } else if (job.kind === 'fire') {
        await this.actions.fire(job.accountId, job.ids);
      } else {
        const sp = await this._spenderFor(job.accountId, job.ids);
        await this.actions.toSpender(job.accountId, sp, job.ids);
      }
      this.pending = this.pending.filter(p => p !== job);
      this.capRelief(job.accountId);
    } catch (error) {
      job.tries += 1;
      job.nextAt = this.now() + ACTION_RETRY_MS;
      if (job.tries >= 10) { this.pending = this.pending.filter(p => p !== job); this._log('error', 'ad.handFailed', { error: error.message }, `Drafted players could not be handed on: ${error.message} · they stay in the Draft list`, job.accountId); }
      else if (!/Auto Trade is using/i.test(error.message)) this._log('warning', 'ad.handRetry', { error: error.message }, `Handing on failed (${error.message}) · trying again in 30 s`, job.accountId);
    }
  }

  // a Harcayıcı with room and TK (Auto Trade's floor), not used by Auto Trade; none → the account itself
  async _spenderFor(accountId, ids) {
    if (this._accounts().find(a => a.id === accountId)?.role === 'spender') return accountId;
    const floor = Number(this.atConfig()?.spenderMinTk) || 0;
    const rows = (this.draft.snapshot().drafted?.[accountId] || []).filter(r => ids.includes(r.id));
    const cost = rows.reduce((n, r) => n + (Number(r.salary ?? r.value) || 0), 0);
    const cands = this._accounts().filter(a => a.role === 'spender' && a.id !== accountId && this._userId(a.id) && !this.isBusy(a.id))
      .map(a => ({ id: a.id, tk: Number(this._profile(a.id).tk) || 0 })).filter(x => x.tk - cost >= floor).sort((a, b) => b.tk - a.tk);
    for (const c of cands) {
      const total = await this._rosterTotal(c.id).catch(() => ROSTER_MAX);
      if (total + ids.length <= ROSTER_MAX) return c.id;
    }
    this._log('info', 'ad.noSpender', {}, 'No free Harcayıcı with room and TK · the account lists them itself', accountId);
    return accountId;
  }

  shutdown() { clearTimeout(this.timer); this.timer = null; }
}

module.exports = { AutoDraftService };
