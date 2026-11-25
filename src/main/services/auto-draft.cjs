// Automatic Draft (user 2026-11-24, rules redone 2026-11-26). Over the Draft service:
//  - a new room that fits a chosen account's level: ONE account with attempts joins at once and
//    sees the pool (every open room at the same time);
//  - the pool's role players are counted (N) and N-1 more accounts join (5 role players → 4 more),
//    while the room has seats. "Cheap players count as Kart" (option, price limit) adds the players
//    at or under the price; "only Stok" (option, always off at start) counts only Stok players.
//    With Stok in the pool, at least one Lv30+ account (Lv30 included) is in the room (only matters
//    in the Lv21–30 rooms);
//  - on its turn, after a random 2–4 s, an account picks by the priority Stok → Satılabilir → Kart
//    (→ any other role) → cheap players (as Kart; the cheapest first). It never picks a player its
//    own roster already has (that one is left to another account of ours); an "already signed"
//    answer makes it pick the next one. Stok goes to Lv30+ accounts first;
//  - an account left without a role player (others took them, or the pool has none) takes the
//    cheapest player and it is made into a card (option: fire / nothing). No account joins for
//    these players;
//  - after the draft: Kart and cheap players → main → star cards; Satılabilir / Stok → the Harcayıcı
//    with the most TK (room and TK enough), listed at Auto Trade's price;
//  - it goes on until the chosen accounts have no draft attempts left.
const { GameSocket } = require('./game-socket.cjs');
const R = require('./trade-rules.cjs');
const { levelRange } = require('./draft-service.cjs');

const TICK_MS = 700;
const TURN_MS = 250;       // how often our turns are looked at
const ROSTER_CHECKS = 10;  // roster reads at a time when choosing accounts for a room
const PICK_DELAY = [2000, 4000];
const PICK_TRIES_AD = 6;   // players tried on one turn (taken / already in our roster → the next)
const CHEAP = '__cheap';   // the pseudo role of a cheap player counted as Kart
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
    this.turnTimer = null;
    this.reserved = new Set(); // accounts picked for a room and still joining it
    // "only Stok" is always off when the app starts (user 2026-11-26)
    const saved = this.store.getSettings?.()?.autoDraft;
    if (saved?.stokOnly) { try { this.store.saveSettings({ ...this.store.getSettings(), autoDraft: { ...saved, stokOnly: false } }); } catch {} }
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
      sideOnly: Boolean(saved.sideOnly),
      cheapAsCard: Boolean(saved.cheapAsCard),
      cheapPrice: Number(saved.cheapPrice) > 0 ? Number(saved.cheapPrice) : 70,
      stokOnly: Boolean(saved.stokOnly)
    };
  }
  saveConfig(patch = {}) {
    const s = this.store.getSettings();
    const cur = this.config();
    const next = { ...cur, ...patch };
    this.store.saveSettings({ ...s, autoDraft: { accountIds: next.accountIds, priority: next.priority, fallback: next.fallback, sideOnly: next.sideOnly, cheapAsCard: Boolean(next.cheapAsCard), cheapPrice: Number(next.cheapPrice) > 0 ? Math.round(Number(next.cheapPrice)) : 70, stokOnly: Boolean(next.stokOnly) } });
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
    // our turns: a fast loop of its own
    clearInterval(this.turnTimer);
    this.turnTimer = setInterval(() => { if (this.run?.status === 'running') this._turns().catch(() => {}); }, TURN_MS);
    return this.snapshot();
  }

  stop(reason = 'stopped') {
    if (!this.run || this.run.status !== 'running') return this.snapshot();
    clearTimeout(this.timer); this.timer = null;
    clearInterval(this.turnTimer); this.turnTimer = null;
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
    // attempts are read from the game now and then (never counted here), in the background: with
    // 1141 accounts the read takes long and must not hold up the rooms
    if (!run.attemptsBusy && this.now() - run.attemptsAt > ATTEMPTS_EVERY_MS) {
      run.attemptsAt = this.now();
      run.attemptsBusy = true;
      this.draft._refreshAttempts(run.accountIds).catch(() => {}).finally(() => { run.attemptsBusy = false; });
    }
    await this._syncRooms();
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

  // the roster (size and player ids), read without logging in (cached 60 s; a full roster cannot draft)
  async _roster(id) {
    const c = this.rosterCache.get(id);
    if (c && this.now() - c.at < 60000) return c;
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const r = await gs.ack('getTeamOptimized', { userId: this._userId(id) }, { timeoutMs: 10000 });
      const all = [...(r?.players?.starters || []), ...(r?.players?.bench || [])];
      const v = { total: all.length, ids: new Set(all.map(p => p.id || p.playerId).filter(Boolean)), at: this.now() };
      this.rosterCache.set(id, v);
      return v;
    } finally { try { gs.close(); } catch {} }
  }
  async _rosterTotal(id) { return (await this._roster(id)).total; }
  // the account cannot sign this player: its roster has him, or the game said so this draft
  _owns(id, playerId) { return Boolean(this.rosterCache.get(id)?.ids?.has(playerId)) || Boolean(this.run?.accounts?.[id]?.skip?.includes(playerId)); }

  // free accounts for a room: chosen, attempts left, fit the level, in no room, not used by Auto
  // Trade, roster not full. `lv30`: 'only' Lv30+ accounts, 'first' or 'last' (Lv30 included).
  async _free(slot, n, { lv30 = 'last', not = [] } = {}) {
    const out = [];
    if (n <= 0) return out;
    const hi = id => (this._level(id) || 0) >= 30;
    const cands = this.run.accountIds
      .filter(id => !not.includes(id) && !this.reserved.has(id) && this._attempts(id) > 0 && !this._inSlot(id) && !this.isBusy(id) && this._fits(id, slot) && (lv30 !== 'only' || hi(id)))
      .sort((a, b) => (lv30 === 'first' ? hi(b) - hi(a) : hi(a) - hi(b)));
    // roster checks a few at a time (each is one short anonymous read)
    for (let i = 0; i < cands.length && out.length < n; i += ROSTER_CHECKS) {
      const chunk = cands.slice(i, i + ROSTER_CHECKS);
      const rosters = await Promise.all(chunk.map(id => this._roster(id).catch(() => null)));
      chunk.forEach((id, k) => {
        if (!rosters[k] || rosters[k].total >= ROSTER_MAX) { if (rosters[k] && this.run.accounts[id]) this.run.accounts[id].state = 'rosterFull'; return; }
        if (out.length < n && !this.reserved.has(id)) out.push(id);
      });
    }
    return out;
  }

  // a new room (not started, no cooldown, seats left) for a level ours fit: ONE account joins at
  // once and sees the pool; every open room at the same time. A Lv30+ account is kept for the
  // Stok players of the pool (a lower one scouts when there is one).
  async _openRooms() {
    for (const s of this.draft.slots || []) {
      const slot = s.slotNumber;
      if (!levelRange(slot)) continue; // rooms 1-2: Rookie draft (Lv20+, attempts of its own), closed this season
      if (this.run.rooms[slot] && !this.run.rooms[slot].ended) continue;
      if (s.hasStarted || s.cooldownRemaining > 0 || (s.users?.length || 0) >= ROOM_SIZE) continue;
      const [scout] = await this._free(slot, 1, { lv30: 'last' });
      if (!scout) continue;
      this.reserved.add(scout);
      const room = this.run.rooms[slot] = { slot, scout, ours: [], extrasDone: false, rolePlayers: null, ended: false, at: new Date(this.now()).toISOString() };
      room.filling = true;
      this._join(room, [scout], { first: true }).finally(() => { room.filling = false; this.reserved.delete(scout); if (!room.ours.length && this.run?.rooms?.[slot] === room) delete this.run.rooms[slot]; this.onChanged(); });
    }
  }

  async _join(room, ids, { first = false } = {}) {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const live = this.draft.rooms.get(room.slot);
      if (this.run?.status !== 'running' || live?.started || room.ended) break;
      if (i > 0 || !first) await sleep(rand(JOIN_GAP));
      this.run.accounts[id] = { ...this.run.accounts[id], state: 'joining', slot: room.slot };
      this.onChanged();
      try {
        await this.draft.join(id, room.slot);
        room.ours.push(id);
        this.run.accounts[id].state = 'inRoom';
        if (first && i === 0) this._log('info', 'ad.joined', { slot: room.slot }, `Joined draft room ${room.slot} first · looking at the players`, id);
      } catch (error) {
        this.run.accounts[id].state = 'waiting';
        this.run.accounts[id].slot = null;
        this._log('warning', 'ad.joinFailed', { slot: room.slot, error: error.message }, `Could not join room ${room.slot}: ${error.message}`, id);
        if (/cool|full|start|progress/i.test(error.message)) break;
      }
    }
  }

  _roleOf(player) {
    const map = R.roleMapFrom(this.store.getCardMetadata?.() || {});
    const roles = map.get(player.id) || [];
    const order = this.config().priority;
    const ranked = roles.filter(r => order.includes(r)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return ranked[0] || null;
  }
  _dirOf(role) {
    if (role === CHEAP) return 'main';
    const at = this.atConfig() || {};
    const toMain = at.sideToMainRoleIds || ['card'];
    const toSide = at.mainToSideRoleIds || ['sellable'];
    if (toSide.includes(role) || /^sto(k|ck)/i.test(String(this.roles().find(r => r.id === role)?.name || ''))) return 'side';
    if (toMain.includes(role)) return 'main';
    return 'side';
  }
  _isStok(role) { return role !== CHEAP && /^sto(k|ck)/i.test(String(this.roles().find(r => r.id === role)?.name || '').trim()); }
  // the pool's players we want, best first: by the role priority, cheap players (counted as Kart,
  // option) after every role, the cheapest of them first; in a role the higher salary first
  _wanted(players) {
    const cfg = this.config();
    const out = [];
    for (const p of players || []) {
      if (p.signed) continue;
      let role = this._roleOf(p);
      const price = Number(p.baseSalary) || 0;
      if (!role && cfg.cheapAsCard && price > 0 && price <= cfg.cheapPrice) role = CHEAP;
      if (!role || (cfg.sideOnly && this._dirOf(role) === 'main')) continue;
      out.push({ p, role });
    }
    const rank = r => (r === CHEAP ? 1e6 : cfg.priority.indexOf(r));
    return out.sort((a, b) => (rank(a.role) - rank(b.role)) || (a.role === CHEAP ? (Number(a.p.baseSalary) || 0) - (Number(b.p.baseSalary) || 0) : (Number(b.p.baseSalary) || 0) - (Number(a.p.baseSalary) || 0)));
  }

  // after the scout sees the pool: N role players → N-1 more accounts (only Stok: N = Stok players),
  // with a Lv30+ account in the room for the Stok players
  _extrasPlan(room, players, seats) {
    const cfg = this.config();
    const wanted = this._wanted(players);
    const stok = wanted.filter(w => this._isStok(w.role)).length;
    const counted = cfg.stokOnly ? stok : wanted.length;
    const hiIn = room.ours.filter(a => (this._level(a) || 0) >= 30).length;
    const hiNeed = stok ? Math.max(0, Math.min(stok, Math.max(counted, 1)) - hiIn) : 0;
    const extra = Math.max(0, Math.min(seats, Math.max(counted - room.ours.length, hiNeed)));
    return { counted, stok, extra, hiNeed: Math.min(hiNeed, extra) };
  }

  async _syncRooms() {
    for (const room of Object.values(this.run.rooms)) {
      if (room.ended) continue;
      const live = this.draft.rooms.get(room.slot);
      if (!live) continue;
      if (live.ended) { await this._roomEnded(room); continue; }
      if (!room.extrasDone && !room.filling && room.ours.length && (live.players || []).length) {
        room.extrasDone = true;
        const seats = ROOM_SIZE - Math.max((live.users || []).length, room.ours.length);
        const plan = this._extrasPlan(room, live.players, seats);
        room.rolePlayers = plan.counted;
        this._log('info', 'ad.pool', { slot: room.slot, count: plan.counted, extra: plan.extra }, `Room ${room.slot}: ${plan.counted} player(s) with a role · ${plan.extra} more account(s) join`, room.scout);
        if (live.started || plan.extra <= 0) continue;
        const hi = await this._free(room.slot, plan.hiNeed, { lv30: 'only' });
        hi.forEach(id => this.reserved.add(id));
        const rest = await this._free(room.slot, plan.extra - hi.length, { lv30: 'last', not: hi });
        rest.forEach(id => this.reserved.add(id));
        const ids = [...hi, ...rest];
        room.filling = true;
        this._join(room, ids).finally(() => { room.filling = false; ids.forEach(id => this.reserved.delete(id)); this.onChanged(); });
      }
    }
  }

  // our account's turn: a random 2–4 s, then the best player for it
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
      // the roster is read meanwhile, so a player we already have is not tried
      this._roster(id).catch(() => {});
      setTimeout(() => this._pick(room, id).catch(error => this._log('warning', 'ad.pickFailed', { error: error.message }, `Pick failed: ${error.message}`, id)), delay);
    }
  }

  _choose(room, id, live) {
    const cfg = this.config();
    const wanted = this._wanted(live.players);
    const mineAll = wanted.filter(w => !this._owns(id, w.p.id));
    // Stok is left for a Lv30+ account of ours that still has to pick (it may get the 5% cut)
    const picked = new Set(live.picked || []);
    const lv30Left = room.ours.filter(a => a !== id && !picked.has(a) && (this._level(a) || 0) >= 30).length;
    const stokLeft = mineAll.filter(w => this._isStok(w.role)).length;
    const mine = (this._level(id) || 0) >= 30 || stokLeft > lv30Left ? mineAll : mineAll.filter(w => !this._isStok(w.role));
    if (mine.length) return { player: mine[0].p, role: mine[0].role === CHEAP ? null : mine[0].role, kind: this._dirOf(mine[0].role) === 'main' ? 'cards' : 'spender' };
    // no role player for this account: the cheapest player (not one left for another of ours)
    if (cfg.fallback === 'none' || cfg.sideOnly) return null;
    const kept = new Set(wanted.map(w => w.p.id));
    const free = (live.players || []).filter(p => !p.signed && Number(p.baseSalary) > 0 && !this._owns(id, p.id));
    const pool = (free.some(p => !kept.has(p.id)) ? free.filter(p => !kept.has(p.id)) : free).sort((a, b) => Number(a.baseSalary) - Number(b.baseSalary));
    return pool[0] ? { player: pool[0], role: null, kind: cfg.fallback === 'fire' ? 'fire' : 'cards' } : null;
  }

  async _pick(room, id) {
    const live = this.draft.rooms.get(room.slot);
    if (!live || live.ended || this.run?.status !== 'running') return;
    if (this.draft.joined.get(id)?.userId !== live.turn?.userId) return; // the turn moved on
    const acc = this.run.accounts[id];
    acc.skip ||= [];
    let c = null;
    // taken by someone else meanwhile, or already in our roster ("already signed"): the next one
    for (let attempt = 0; attempt < PICK_TRIES_AD; attempt++) {
      c = this._choose(room, id, live);
      if (!c) break;
      try { await this.draft.pick(id, c.player.id); break; }
      catch (error) {
        if (!/already|signed|picked|roster|own|have/i.test(error.message) || attempt === PICK_TRIES_AD - 1) throw error;
        if (!c.player.signed) acc.skip.push(c.player.id); // the game says we have him: left for another account
        c = null;
      }
    }
    if (!c) { acc.state = 'noPick'; this._log('info', 'ad.noPick', { slot: room.slot }, `Room ${room.slot}: nothing to pick for this account`, id); this.onChanged(); return; }
    this.draft.tagRows(id, { [c.player.id]: { role: c.role, auto: c.kind } });
    acc.picks.push({ name: c.player.visualName || c.player.name, role: c.role, kind: c.kind, slot: room.slot });
    acc.state = 'picked';
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

  shutdown() { clearTimeout(this.timer); this.timer = null; clearInterval(this.turnTimer); this.turnTimer = null; }
}

module.exports = { AutoDraftService };
