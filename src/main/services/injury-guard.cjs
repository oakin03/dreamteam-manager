const { GameSocket } = require('./game-socket.cjs');
const { WIDE, eachWithSocket, eachAtOnce } = require('./wide.cjs');

// Injuries (user 2026-11-18): the game now refuses every match while a starter is injured and not
// healed ("Cannot start quick play / create match / ...: The following starter players are injured
// and not healed: A, B. Please heal or replace them with healthy players."). Every service retried
// on its own: ~39 000 refusals in a day, Auto Play looked like it waited for a match.
// Read from the game client (team page):
//   roster players: isInjured, isHealed, healedUntil, slot (starter 1–5) | benchSlot
//   Anesthesia (item cmh8wufxu0000ok34akqv2yih) heals for a while:
//     useHealingItem {userId, playerId, itemId, quantity} (ack) -> {success, message, healedUntil, error}
//   replace: updatePlayerPositions {userId, starters[{playerId, slot}], bench[{playerId, benchSlot}]} (ack)
// One guard for every service: a refusal is reported once, the account waits (no retry storm) and
// is fixed by swapping in a healthy bench player (default on) or Anesthesia (when allowed for the
// account); a recheck every few minutes clears the account once no starter is injured any more.
// A swapped-out starter goes back to its place once it is healthy again.
const ANESTHESIA_ID = 'cmh8wufxu0000ok34akqv2yih';
const INJURY_RE = /injured and not healed/i;
const AUTH = /auth|user id is required|not authenticated|unauthor|register/i;
const READ_TIMEOUT_MS = 12000;
const RECHECK_MS = 3 * 60 * 1000;
const FIX_GAP_MS = 5 * 60 * 1000;
// replaceAuto: the new-player replacement also runs by itself (daily player refresh, Anesthesia page)
// injuredAction: what happens to the injured starter that is replaced: 'fire' | 'list'
const SETTINGS_DEFAULT = { autoSwap: true, autoHeal: false, healAccounts: [], replaceAuto: false, injuredAction: 'fire' };
const ROSTER_MAX = 11;
const BOARD_TTL_MS = 60 * 1000; // our accounts' Scout boards are read once a minute for every replacement
const PARK_PRICE = 999999; // an injured starter waits on the market at this price (nobody buys it)
const salaryOf = p => Number(p?.signedSalary ?? p?.salary ?? p?.baseSalary) || 0;

const isInjuryError = msg => INJURY_RE.test(String(msg || ''));
function injuredNamesOf(msg) {
  const m = String(msg || '').match(/injured and not healed:\s*([^.]*)\./i);
  return m ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
}
const hurt = p => Boolean(p?.isInjured) && !(p.isHealed && (!p.healedUntil || Date.parse(p.healedUntil) > Date.now()));
const pid = p => p?.id || p?.playerId;
// starters come in the roster's own starters list (tagged when read); slot 1–5 otherwise
const isStarter = p => (p?.__starter != null ? p.__starter : Number(p?.slot) > 0);
// slot is the position the starter plays: 'PG' | 'SG' | 'SF' | 'PF' | 'C'
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
const slotOf = p => p?.slot || p?.__slot || null;
const slotIdx = sl => { const i = SLOTS.indexOf(sl); return i < 0 ? 9 : i; };
const plays = (p, sl) => String(p?.position || '').split('/').includes(sl);
const power = p => (Number(p?.totalOffense ?? p?.offense) || 0) + (Number(p?.totalDefense ?? p?.defense) || 0);

// The lineup with every injured starter replaced by the best healthy bench player (same position
// first). Returns { starters, bench, swaps } or null when nothing can be done.
function planSwaps(players) {
  const starters = players.filter(p => isStarter(p)).sort((a, b) => slotIdx(slotOf(a)) - slotIdx(slotOf(b)));
  const bench = players.filter(p => !(isStarter(p)));
  const free = bench.filter(p => !hurt(p) && !p.isTemporary);
  const swaps = [];
  for (const s of starters.filter(hurt)) {
    if (!free.length) break;
    free.sort((a, b) => plays(b, slotOf(s)) - plays(a, slotOf(s)) || power(b) - power(a));
    const inP = free.shift();
    swaps.push({ out: s, in: inP, slot: slotOf(s), benchSlot: Number(inP.benchSlot) || null });
  }
  if (!swaps.length) return null;
  const outIds = new Set(swaps.map(w => pid(w.out)));
  const inIds = new Set(swaps.map(w => pid(w.in)));
  const st = starters.filter(p => !outIds.has(pid(p))).map(p => ({ playerId: pid(p), slot: slotOf(p) }))
    .concat(swaps.map(w => ({ playerId: pid(w.in), slot: w.slot })));
  const benchIds = bench.filter(p => !inIds.has(pid(p))).map(pid).concat(swaps.map(w => pid(w.out)));
  return { starters: st.sort((a, b) => slotIdx(a.slot) - slotIdx(b.slot)), bench: benchIds.map((id, i) => ({ playerId: id, benchSlot: i + 1 })), swaps };
}

class InjuryGuard {
  constructor({ store, activity, sessions, createSocket, onChanged, now = () => Date.now(), parallel = WIDE, friendNet = null, priceOf = null, isBusy = () => false, onAttention = null }) {
    Object.assign(this, { store, activity, sessions, createSocket, now, parallel, friendNet, priceOf, isBusy, onAttention });
    this.onChanged = onChanged || (() => {});
    this.blocked = {};   // accountId -> { names, source, at, lastFixAt, fixing }
    this.teams = {};     // accountId -> { players: [{id, name, position, starter, injured, healed, healedUntil}], anesthesia, readAt, error }
    this.reading = false;
    this.busy = new Set();
    this._claimed = new Set(); // "owner:playerId" a replacement of this run already took
    this.waiters = new Map(); // accountId -> Set(resolve)
    this.timer = setInterval(() => this._recheck().catch(() => {}), RECHECK_MS);
    this.timer.unref?.();
  }

  _accounts() { return (this.store.getAccounts?.() || []).filter(a => !a.signupPending); }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _name(id) { return this._account(id)?.name || id; }
  _log(id, level, code, params, message) { this.activity?.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'Sakatlık', code: `inj.${code}`, params, message }); }
  settings() { return { ...SETTINGS_DEFAULT, ...(this.store.getSettings?.()?.injury || {}) }; }
  saveSettings(patch = {}) {
    const s = this.store.getSettings?.() || {};
    const ids = new Set(this._accounts().map(a => a.id));
    const next = { ...this.settings(), ...patch };
    next.healAccounts = (next.healAccounts || []).filter(id => ids.has(id));
    this.store.saveSettings?.({ ...s, injury: next });
    this.onChanged();
    return this.snapshot();
  }
  _swapsSaved() { return this.store.getSettings?.()?.injurySwaps || {}; }
  _saveSwaps(all) { const s = this.store.getSettings?.() || {}; this.store.saveSettings?.({ ...s, injurySwaps: all }); }

  snapshot() {
    return { blocked: JSON.parse(JSON.stringify(this.blocked)), teams: JSON.parse(JSON.stringify(this.teams)), reading: this.reading, busy: [...this.busy], settings: this.settings(), swaps: this._swapsSaved(), parked: this.parked() };
  }
  isBlocked(id) { return Boolean(this.blocked[id]); }

  // --- reading ---------------------------------------------------------------------------
  async _readOne(gs, id) {
    const userId = this._userId(id);
    const team = await gs.ack('getTeamOptimized', { userId }, { timeoutMs: READ_TIMEOUT_MS });
    const all = rosterRows(team);
    const inv = await gs.call('getUserInventory', { userId }, 'userInventoryData', { timeoutMs: READ_TIMEOUT_MS }).catch(() => null);
    const list = Array.isArray(inv) ? inv : (inv?.inventory || inv?.items || []);
    const anesthesia = list.filter(x => (x.itemId || x.item?.id) === ANESTHESIA_ID).reduce((n, x) => n + (Number(x.quantity) || 0), 0);
    this.teams[id] = {
      players: all.map(p => ({ id: pid(p), name: p.visualName || p.name, position: p.position, rating: p.rating, starter: isStarter(p), slot: slotOf(p) || null, injured: Boolean(p.isInjured), healed: Boolean(p.isHealed), healedUntil: p.healedUntil || null, hurt: hurt(p) })),
      anesthesia, readAt: new Date(this.now()).toISOString(), error: null
    };
    return all;
  }

  // Every account's (or the given ones') roster and Anesthesia count, no sign-in.
  async scan(accountIds = null) {
    if (this.reading) return this.snapshot();
    const ids = (accountIds?.length ? accountIds : this._accounts().map(a => a.id)).filter(id => this._userId(id));
    this.reading = true; this.onChanged();
    try {
      await eachWithSocket(ids, () => GameSocket.open({ createSocket: this.createSocket }), async (gs, id) => {
        const all = await this._readOne(gs, id);
        if (this.blocked[id] && !all.some(p => isStarter(p) && hurt(p))) this._clear(id);
      }, { limit: this.parallel, onError: (id, e) => { this.teams[id] = { ...(this.teams[id] || {}), error: e.message }; } });
    } finally { this.reading = false; this.onChanged(); }
    return this.snapshot();
  }

  async _roster(id) {
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try { return await this._readOne(gs, id); } finally { try { gs.close(); } catch {} }
  }

  // --- the guard ---------------------------------------------------------------------------
  // A service got the injury refusal: logged once per account (again only when the names change),
  // the account is fixed when it can be. Returns true when the account can play again right away.
  async report(accountId, message, source = '') {
    if (!isInjuryError(message)) return false;
    const names = injuredNamesOf(message);
    const b = this.blocked[accountId];
    if (!b || b.names.join() !== names.join()) {
      this.blocked[accountId] = { names, source, at: new Date(this.now()).toISOString(), lastFixAt: b?.lastFixAt || 0 };
      this._log(accountId, 'warning', 'blocked', { names: names.join(', '), source }, `Injured starter(s): ${names.join(', ')} · matches wait (${source}) until they are healed or replaced`);
      this.onChanged();
    }
    return this.fix(accountId);
  }

  // Swap / heal now (at most every few minutes per account). true when no starter is hurt after it.
  async fix(accountId, { force = false } = {}) {
    const b = this.blocked[accountId];
    if (b?.fixing) return b.fixing;
    if (b && !force && this.now() - (b.lastFixAt || 0) < FIX_GAP_MS) return false;
    const run = (async () => {
      try {
        const all = await this._roster(accountId);
        let starters = all.filter(p => isStarter(p));
        if (!starters.some(hurt)) { this._clear(accountId); return true; }
        const st = this.settings();
        // a new player first, when the automatic replacement is on (user 2026-11-24)
        if (st.replaceAuto && !this.isBusy(accountId)) {
          let ok = true;
          for (const p of starters.filter(hurt)) if (!(await this._replaceOne(accountId, p, 'park').catch(e => { this._log(accountId, 'warning', 'replaceFailed', { error: e.message }, `Injured starter could not be replaced: ${e.message}`); return false; }))) ok = false;
          if (ok) { starters = (await this._roster(accountId)).filter(p => isStarter(p)); if (!starters.some(hurt)) { this._clear(accountId); return true; } }
        }
        if (st.autoHeal && st.healAccounts.includes(accountId)) {
          const left = this.teams[accountId]?.anesthesia || 0;
          if (left > 0) {
            const targets = starters.filter(hurt).slice(0, left).map(p => pid(p));
            await this._healOne(accountId, targets, 1, 'auto').catch(() => null);
            starters = (await this._roster(accountId)).filter(p => isStarter(p));
            if (!starters.some(hurt)) { this._clear(accountId); return true; }
          }
        }
        if (st.autoSwap) {
          const ok = await this._swap(accountId).catch(e => { this._log(accountId, 'warning', 'swapFailed', { error: e.message }, `Lineup could not be changed: ${e.message}`); return false; });
          if (ok) { this._clear(accountId); return true; }
        }
        if (this.blocked[accountId] && !this.blocked[accountId].told) {
          this.blocked[accountId].told = true;
          const anes = this.teams[accountId]?.anesthesia || 0;
          this._log(accountId, 'warning', 'needsHelp', { anesthesia: anes }, `No healthy bench player to swap in · ${anes ? `${anes} Anesthesia in the bag, use it on Bag → Anesthesia` : 'no Anesthesia in the bag'}`);
        }
        return false;
      } finally {
        if (this.blocked[accountId]) { this.blocked[accountId].lastFixAt = this.now(); delete this.blocked[accountId].fixing; }
        this.onChanged();
      }
    })();
    if (this.blocked[accountId]) this.blocked[accountId].fixing = run;
    return run;
  }

  // Waits (no retries meanwhile) until the account can play again; false when stopped.
  waitClear(accountId, signal) {
    if (!this.blocked[accountId]) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = v => { signal?.removeEventListener?.('abort', onAbort); this.waiters.get(accountId)?.delete(done); resolve(v); };
      const onAbort = () => done(false);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      if (!this.waiters.has(accountId)) this.waiters.set(accountId, new Set());
      this.waiters.get(accountId).add(done);
    });
  }

  _clear(id) {
    if (!this.blocked[id]) return;
    const b = this.blocked[id];
    delete this.blocked[id];
    this._log(id, 'success', 'cleared', { names: b.names.join(', ') }, `No injured starter any more · matches go on`);
    for (const w of this.waiters.get(id) || []) w(true);
    this.waiters.delete(id);
    this.onChanged();
  }

  // Blocked accounts are read again every few minutes (a heal by hand, a player back from injury);
  // a swapped-out starter that is healthy again goes back to its slot.
  async _recheck() {
    for (const id of Object.keys(this.blocked)) {
      if (this.blocked[id]?.fixing) continue;
      const all = await this._roster(id).catch(() => null);
      if (all && !all.some(p => isStarter(p) && hurt(p))) this._clear(id);
      else if (all) this.fix(id).catch(() => {});
    }
    const swaps = this._swapsSaved();
    for (const id of Object.keys(swaps)) await this._restore(id).catch(() => {});
  }

  // --- writes ----------------------------------------------------------------------------
  async _conn(id) {
    const account = this._account(id);
    if (!account) throw new Error('Account not found.');
    const session = await this.sessions.get(account, { owner: 'injury' });
    const borrowed = GameSocket.borrow?.(session.userId);
    if (borrowed) return { gs: borrowed, userId: session.userId, own: false };
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader });
    return { gs, userId: session.userId, own: true, registered: false };
  }
  // market:sellPlayer answers on an event, not an ack
  async _sell(c, playerId, price, currency) {
    const payload = { userId: c.userId, playerId, price: Number(price), paymentMode: currency === 'TIX' ? 'TICKET' : 'APK_TICKET' };
    const once = () => c.gs.call('market:sellPlayer', payload, 'market:sellResult', { timeoutMs: 20000 }).catch(e => ({ success: false, message: e.message }));
    let r = await once();
    if (!r?.success && c.own && !c.registered && AUTH.test(String(r?.message || r?.error || ''))) { await c.gs.register(c.userId, { owner: 'Sakatlık' }); c.registered = true; r = await once(); }
    return r;
  }
  async _write(c, event, payload) {
    let r = await c.gs.ack(event, payload, { timeoutMs: 20000 }).catch(e => ({ success: false, message: e.message }));
    if (!r?.success && c.own && !c.registered && AUTH.test(String(r?.message || r?.error || ''))) {
      await c.gs.register(c.userId, { owner: 'Sakatlık' });
      c.registered = true;
      r = await c.gs.ack(event, payload, { timeoutMs: 20000 }).catch(e => ({ success: false, message: e.message }));
    }
    return r;
  }

  async _swap(id) {
    const all = await this._roster(id);
    const plan = planSwaps(all);
    if (!plan) return false;
    const c = await this._conn(id);
    try {
      const r = await this._write(c, 'updatePlayerPositions', { userId: c.userId, starters: plan.starters, bench: plan.bench });
      if (!r?.success) throw new Error(r?.message || r?.error || 'refused');
    } finally { if (c.own) { try { c.gs.close(); } catch {} } }
    const after = await this._roster(id);
    if (after.some(p => isStarter(p) && hurt(p))) return false;
    const all2 = this._swapsSaved();
    all2[id] = [...(all2[id] || []), ...plan.swaps.map(w => ({ outId: pid(w.out), outName: w.out.visualName || w.out.name, inId: pid(w.in), inName: w.in.visualName || w.in.name, slot: w.slot, at: new Date(this.now()).toISOString() }))];
    this._saveSwaps(all2);
    for (const w of plan.swaps) this._log(id, 'success', 'swapped', { out: w.out.visualName || w.out.name, in: w.in.visualName || w.in.name }, `${w.out.visualName || w.out.name} (injured) → bench · ${w.in.visualName || w.in.name} starts`);
    return true;
  }

  // "Missing starter players in positions: C" (seen 2026-11-24 on 64 new accounts): an empty
  // starter slot gets a healthy bench player, one that plays that position when there is one.
  // true when every slot is filled afterwards (the caller tries the match again).
  async fillMissing(id) {
    if (this._filling?.has(id)) return this._filling.get(id);
    const run = (async () => {
      const all = await this._roster(id);
      const plan = lineupFix(all);
      if (!plan) return true;
      if (plan.short) {
        this._log(id, 'warning', 'slotNoBench', { slots: plan.empty.join(', ') }, `Empty starter position ${plan.empty.join(', ')} · no healthy player to put there`);
        return false;
      }
      const c = await this._conn(id);
      try {
        const r = await this._write(c, 'updatePlayerPositions', { userId: c.userId, starters: plan.starters, bench: plan.bench });
        if (!r?.success) throw new Error(r?.message || r?.error || 'refused');
      } finally { if (c.own) { try { c.gs.close(); } catch {} } }
      this._log(id, 'success', 'slotFilled', { slots: plan.empty.join(', '), lineup: plan.text }, `Empty starter position ${plan.empty.join(', ')} filled · ${plan.text}`);
      return true;
    })().catch(error => { this._log(id, 'warning', 'slotFillFailed', { error: error.message }, `Empty starter position could not be filled: ${error.message}`); return false; })
      .finally(() => this._filling.delete(id));
    (this._filling ||= new Map()).set(id, run);
    return run;
  }

  // A swapped-out starter that is healthy again goes back to its slot (when nothing else moved).
  async _restore(id) {
    const all2 = this._swapsSaved();
    const list = all2[id] || [];
    if (!list.length) { delete all2[id]; this._saveSwaps(all2); return; }
    const all = await this._roster(id);
    const byId = new Map(all.map(p => [pid(p), p]));
    const keep = [];
    const back = [];
    for (const w of list) {
      const out = byId.get(w.outId), inP = byId.get(w.inId);
      if (!out || !inP) continue;                                  // traded / fired: forget it
      if (!isStarter(inP) || slotOf(inP) !== w.slot || isStarter(out)) continue; // lineup changed since: forget it
      if (hurt(out)) { keep.push(w); continue; }
      back.push(w);
    }
    if (back.length) {
      const starters = all.filter(p => isStarter(p)).map(p => { const w = back.find(x => x.inId === pid(p)); return { playerId: w ? w.outId : pid(p), slot: slotOf(p) }; });
      const benchIds = all.filter(p => !(isStarter(p))).map(p => { const w = back.find(x => x.outId === pid(p)); return w ? w.inId : pid(p); });
      const c = await this._conn(id);
      try {
        const r = await this._write(c, 'updatePlayerPositions', { userId: c.userId, starters, bench: benchIds.map((pId, i) => ({ playerId: pId, benchSlot: i + 1 })) });
        if (!r?.success) { keep.push(...back); back.length = 0; }
      } finally { if (c.own) { try { c.gs.close(); } catch {} } }
      for (const w of back) this._log(id, 'success', 'restored', { out: w.outName, in: w.inName }, `${w.outName} is healthy again · back in the starting five (${w.inName} → bench)`);
    }
    if (keep.length) all2[id] = keep; else delete all2[id];
    this._saveSwaps(all2);
  }

  async _healOne(id, playerIds, quantity = 1, why = 'hand') {
    const c = await this._conn(id);
    const out = [];
    try {
      for (const playerId of playerIds) {
        const r = await this._write(c, 'useHealingItem', { userId: c.userId, playerId, itemId: ANESTHESIA_ID, quantity: Math.max(1, Number(quantity) || 1) });
        const name = this.teams[id]?.players?.find(p => p.id === playerId)?.name || playerId;
        if (r?.success) {
          out.push({ playerId, ok: true, healedUntil: r.healedUntil || null });
          this._log(id, 'success', 'healed', { name, until: r.healedUntil || '?' }, `${name} healed with Anesthesia${r.healedUntil ? ` until ${r.healedUntil}` : ''}${why === 'auto' ? ' (automatic)' : ''}`);
        } else {
          const error = r?.error || r?.message || 'refused';
          out.push({ playerId, ok: false, error });
          this._log(id, 'warning', 'healFailed', { name, error }, `${name} could not be healed: ${error}`);
          if (/don't have|no .*item|not enough|insufficient/i.test(error)) break;
        }
      }
    } finally { if (c.own) { try { c.gs.close(); } catch {} } }
    return out;
  }

  // Bag → Anesthesia: heal the chosen players ({accountId, playerId}[]), every account at once.
  async heal(items, quantity = 1) {
    const by = {};
    for (const it of items || []) if (it?.accountId && it?.playerId) (by[it.accountId] ||= []).push(it.playerId);
    const results = {};
    await eachAtOnce(Object.keys(by), async id => {
      if (this.busy.has(id)) { results[id] = [{ ok: false, error: 'busy' }]; return; }
      this.busy.add(id); this.onChanged();
      try {
        await this._roster(id).catch(() => null);
        const have = this.teams[id]?.anesthesia || 0;
        if (!have) { results[id] = by[id].map(playerId => ({ playerId, ok: false, error: 'noItem' })); return; }
        results[id] = await this._healOne(id, by[id].slice(0, Math.floor(have / Math.max(1, quantity)) || 1), quantity);
        const all = await this._roster(id).catch(() => null);
        if (all && this.blocked[id] && !all.some(p => isStarter(p) && hurt(p))) this._clear(id);
      } catch (e) { results[id] = by[id].map(playerId => ({ playerId, ok: false, error: e.message })); }
      finally { this.busy.delete(id); this.onChanged(); }
    }, this.parallel);
    return { results, ...this.snapshot() };
  }

  // Bag → Anesthesia "Swap with bench": the same swap the guard does, by hand.
  async swap(accountIds) {
    const results = {};
    await eachAtOnce(accountIds || [], async id => {
      try { results[id] = { ok: await this._swap(id) }; if (results[id].ok) this._clear(id); }
      catch (e) { results[id] = { ok: false, error: e.message }; }
    }, this.parallel);
    return { results, ...this.snapshot() };
  }

  // ---------- a new player for an injured starter (user 2026-11-24) ----------
  // The best player (highest price = best OFF+DEF) the salary cap allows once the injured starter's
  // salary is gone, from the account's own Scout, its friends' Scouts and the Scouts of our other
  // accounts (those become friends first). Only TK is spent: no APK / TIX, no Scout refresh, no
  // Anesthesia. The injured starter is fired or listed (setting), the new one takes its slot.
  // When nothing fits, the bench swap is the second choice.
  // By hand (Bag → Anesthesia): the injured starters of these accounts get a new player now;
  // `action` ('fire' | 'list') is what happens to the injured one (the user chose it there).
  async replace(accountIds, action = this.settings().injuredAction) {
    const results = {};
    if (!this._replacing) this._claimed = new Set();
    this._replacing = (this._replacing || 0) + 1;
    try {
    await eachAtOnce(accountIds || [], async id => {
      if (this.busy.has(id)) { results[id] = { ok: false, error: 'busy' }; return; }
      if (this.isBusy(id)) { results[id] = { ok: false, error: 'Auto Trade is using this account' }; return; }
      this.busy.add(id); this.onChanged();
      try {
        const all = await this._roster(id);
        let ok = true;
        for (const p of all.filter(x => isStarter(x) && hurt(x))) if (!(await this._replaceOne(id, p, action))) ok = false;
        if (!ok && this.settings().autoSwap) ok = await this._swap(id).catch(() => false);
        results[id] = { ok };
        if (ok) this._clear(id);
      } catch (e) { results[id] = { ok: false, error: e.message }; this._log(id, 'warning', 'replaceFailed', { error: e.message }, `Injured starter could not be replaced: ${e.message}`); }
      finally { this.busy.delete(id); this.onChanged(); }
    }, 10);
    } finally { this._replacing -= 1; }
    return { results, ...this.snapshot() };
  }

  // Automatic (daily player refresh, Anesthesia page opened, a refused match), user 2026-11-24: the
  // injured starter is put on the market at 999999 TIX (parked, nobody buys it) and the best new
  // player takes its place; the parked ones are listed on Bag → Anesthesia, where the user fires them
  // or lists them again at a price. Nothing fits: the bench swap.
  async autoRun(source = '') {
    if (!this.settings().replaceAuto || this._autoRunning) return;
    this._autoRunning = true;
    try {
      await this.scan();
      const ids = Object.entries(this.teams).filter(([, t]) => (t.players || []).some(p => p.starter && p.hurt)).map(([id]) => id);
      if (!ids.length) return;
      this._log(null, 'info', 'autoRun', { count: ids.length, source }, `Injured starters on ${ids.length} account(s) · replacing (${source})`);
      await this.replace(ids, 'park');
    } finally { this._autoRunning = false; }
  }

  // the injured players parked on the market by the automatic replacement
  parked() { return this.store.getSettings?.()?.injuryParked || []; }
  _saveParked(list) { const s = this.store.getSettings?.() || {}; this.store.saveSettings?.({ ...s, injuryParked: list }); this.onChanged(); }
  dropParked(items) {
    const keys = new Set((items || []).map(x => `${x.accountId}:${x.playerId}`));
    this._saveParked(this.parked().filter(x => !keys.has(`${x.accountId}:${x.playerId}`)));
    return this.snapshot();
  }

  // every Scout board this account can sign from: its own, its friends', our other accounts'
  // Every Scout board this account can sign from: its own, its friends', and our other accounts'
  // (read without signing in). 2026-11-24: they were read one by one for every injured player
  // (1000+ accounts → minutes each); now our accounts' boards are read once, 40 at a time on one
  // connection (acks), and kept for BOARD_TTL_MS for every account of the run.
  async _ourBoards(gs) {
    const c = this._boardCache;
    if (c && this.now() - c.at < BOARD_TTL_MS) return c.boards;
    if (this._boardLoading) return this._boardLoading;
    this._boardLoading = (async () => {
      const boards = new Map();
      const accs = this._accounts().map(a => [a.id, this._userId(a.id)]).filter(([, u]) => u);
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(40, accs.length) }, async () => {
        for (let k; (k = i++) < accs.length;) {
          const [accId, u] = accs[k];
          const r = await gs.ack('getFreeAgent', { userId: u }, { timeoutMs: READ_TIMEOUT_MS }).catch(() => null);
          if (r?.freeAgents?.length) boards.set(u, { accId, agents: r.freeAgents });
        }
      }));
      this._boardCache = { at: this.now(), boards };
      return boards;
    })().finally(() => { this._boardLoading = null; });
    return this._boardLoading;
  }

  async _boards(id, gs) {
    const out = [];
    const me = this._userId(id);
    const ours = await this._ourBoards(gs);
    const own = ours.get(me);
    out.push({ owner: null, ownerId: id, agents: own?.agents || [] });
    let friends = null;
    if (this.friendNet) friends = await this.friendNet.friendsOf(id).catch(() => null);
    const friendIds = friends?.ids || new Set();
    // friends that are not our accounts: their boards through the friend list, 4 at a time
    const others = [...friendIds].filter(u => !ours.has(u));
    for (let k = 0; k < others.length && this.friendNet; k += 4) {
      const got = await Promise.all(others.slice(k, k + 4).map(u => this.friendNet.board(id, u).then(b => [u, b]).catch(() => [u, null])));
      for (const [u, b2] of got) if (b2) out.push({ owner: u, ownerId: null, agents: b2.freeAgents || [], friend: true });
    }
    for (const [u, b2] of ours) if (u !== me) out.push({ owner: u, ownerId: b2.accId, agents: b2.agents, friend: friendIds.has(u) });
    return out;
  }

  // The best player for `slot` the cap allows without the injured one's salary (null: none)
  async _findReplacement(id, injured, slot) {
    const name = injured.visualName || injured.name;
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const info = await gs.call('getUserBasicInfo', { userId: this._userId(id) }, 'userBasicInfo', { timeoutMs: READ_TIMEOUT_MS }).catch(() => null);
      const cap = Number(info?.salaryCap) || 0;
      const funds = Number(info?.funds);
      const roster = await this._roster(id);
      const total = roster.reduce((n, p) => n + salaryOf(p), 0);
      const room = cap - (total - salaryOf(injured));
      const have = new Set(roster.map(pid));
      const boards = await this._boards(id, gs);
      const cands = [];
      for (const b of boards) for (const a of b.agents) {
        const price = Number(a.baseSalary) || 0;
        if (a.isSigned || a.isSecret || a.isInjured || have.has(a.id) || !plays(a, slot)) continue;
        if (this._claimed.has(`${b.owner || this._userId(id)}:${a.id}`)) continue;
        if (price <= 0 || price > room || (Number.isFinite(funds) && price > funds)) continue;
        cands.push({ a, price, b });
      }
      cands.sort((x, y) => y.price - x.price);
      // taken for this account: the others of the run look further down the list
      if (cands[0]) this._claimed.add(`${cands[0].b.owner || this._userId(id)}:${cands[0].a.id}`);
      if (!cands[0]) this._log(id, 'info', 'noReplacement', { name, slot, room }, `${name} (${slot}): no healthy ${slot} on the Scouts within the salary cap (${room} TK free)`);
      return cands[0] || null;
    } finally { try { gs.close(); } catch {} }
  }

  // `injured` leaves (action 'fire' | 'list') and the best player takes `slot` (its old place; a
  // bench player standing in for it goes back to the bench).
  async _replaceOne(id, injured, action, slotWas = null) {
    const slot = slotWas || slotOf(injured);
    const name = injured.visualName || injured.name;
    let t = null;
    try {
      const pick = await this._findReplacement(id, injured, slot);
      if (!pick) return false;
      // nothing is changed during a match (the injury came in the middle of one): next time
      const sim = await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/' }).catch(() => null);
      const active = sim ? await sim.ack('getUserActiveMatch', { userId: this._userId(id) }, { timeoutMs: READ_TIMEOUT_MS }).catch(() => null) : null;
      try { sim?.close(); } catch {}
      if (active?.match) { this._log(id, 'info', 'inMatch', { name }, `${name}: the account is in a match · replaced after it`); return false; }
      // the account's open connection when a service has one (nobody is signed out), else its
      // cookie without register (the game asks for it only if it must)
      t = await this._conn(id);
      // The game fires / sells only bench players (2026-11-24: "Team must have more than 5
      // players", "Player not found in team" for starters). So: the new one is signed first and
      // takes the slot, the injured one goes to the bench and leaves from there. A full roster
      // (11): a healthy bench player stands in first, the injured one leaves, then the signing.
      const a = pick.a;
      const sign = async () => {
        if (!pick.b.owner) return this._write(t, 'signFreeAgent', { userId: t.userId, playerId: a.id });
        if (!pick.b.friend && this.friendNet) { await this.friendNet._befriend(id, pick.b.ownerId); this._log(id, 'info', 'befriended', { name: this._name(pick.b.ownerId) }, `${this._name(pick.b.ownerId)} added as a friend to reach its Scout`); }
        return this.friendNet.signFrom(id, pick.b.owner, a.id);
      };
      // `inId` into `slot`; whoever stood there goes to the bench
      const lineup = async inId => {
        const now = await this._roster(id);
        const starters = now.filter(p => isStarter(p) && slotOf(p) !== slot && pid(p) !== inId).map(p => ({ playerId: pid(p), slot: slotOf(p) }));
        starters.push({ playerId: inId, slot });
        const out = now.filter(p => isStarter(p) && slotOf(p) === slot && pid(p) !== inId).map(pid);
        const bench = [...now.filter(p => !isStarter(p) && pid(p) !== inId).map(pid), ...out].map((playerId, i) => ({ playerId, benchSlot: i + 1 }));
        return this._write(t, 'updatePlayerPositions', { userId: t.userId, starters: starters.sort((x, y) => slotIdx(x.slot) - slotIdx(y.slot)), bench });
      };
      const leave = async () => {
        if (action === 'park') {
          const r = await this._sell(t, pid(injured), PARK_PRICE, 'TIX');
          if (!r?.success) return `${name} could not be put on the market: ${r?.message || r?.error || 'refused'}`;
          this._log(id, 'info', 'injuredParked', { name, price: PARK_PRICE }, `${name} (injured) put on the market at ${PARK_PRICE} TIX to wait · Bag → Anesthesia`);
        } else if (action === 'list') {
          const pr = this.priceOf?.({ id: pid(injured), value: injured.baseSalary, salary: salaryOf(injured) }, id);
          if (!pr?.price) return `${name}: no Auto Trade price to list it at · it stays on the bench`;
          const r = await this._sell(t, pid(injured), pr.price, pr.currency);
          if (!r?.success) return `${name} could not be listed: ${r?.message || r?.error || 'refused'}`;
          this._log(id, 'info', 'injuredListed', { name, price: pr.price, currency: pr.currency }, `${name} (injured) listed at ${pr.price} ${pr.currency}`);
        } else {
          const r = await this._write(t, 'firePlayer', { userId: t.userId, playerId: pid(injured) });
          if (!r?.success) return `${name} could not be fired: ${r?.message || r?.error || 'refused'}`;
          this._log(id, 'info', 'injuredFired', { name }, `${name} (injured) fired`);
        }
        return null;
      };
      const rosterNow = await this._roster(id);
      let left = false;
      let leaveError = null;
      if (rosterNow.length >= ROSTER_MAX) {
        const sub = rosterNow.filter(p => !isStarter(p) && !hurt(p)).sort((x, y) => Number(plays(y, slot)) - Number(plays(x, slot)))[0];
        if (!sub) { this._log(id, 'info', 'rosterFull', { name }, `${name}: the roster is full (11) and no healthy bench player can stand in · nothing changed`); return false; }
        const up0 = await lineup(pid(sub));
        if (!up0?.success) throw new Error(`Lineup could not be set: ${up0?.message || up0?.error || 'refused'}`);
        leaveError = await leave();
        if (leaveError) throw new Error(leaveError);
        left = true;
      }
      const r = await sign();
      if (!r?.success) throw new Error(`${a.name} could not be signed: ${r?.message || r?.error || 'refused'}`);
      const up = await lineup(a.id);
      if (!up?.success) this._log(id, 'warning', 'lineupFailed', { error: up?.message || up?.error || '' }, `Lineup could not be set: ${up?.message || up?.error || ''}`);
      if (!left) {
        leaveError = await leave();
        if (leaveError) this._log(id, 'warning', 'leaveFailed', { name, error: leaveError }, `${leaveError} · it stays on the bench`);
      }
      this._log(id, 'success', 'replaced', { out: name, in: a.visualName || a.name, price: pick.price, slot }, `${name} (injured) → ${a.visualName || a.name} (${slot}) · ${pick.price} TK`);
      if (action === 'park' && !leaveError) this._saveParked([...this.parked().filter(x => !(x.accountId === id && x.playerId === pid(injured))), { accountId: id, accountName: this._name(id), playerId: pid(injured), name, rating: injured.rating || null, position: injured.position || null, salary: salaryOf(injured), value: Number(injured.baseSalary) || null, slot, replacedBy: a.visualName || a.name, at: new Date(this.now()).toISOString() }]);
      return true;
    } finally {
      if (t?.own) { try { t.gs.close(); } catch {} }
    }
  }

  shutdown() { clearInterval(this.timer); }
}

// getTeamOptimized → one list, starters marked (their slot kept)
const rosterRows = team => [...(team?.players?.starters || []).map((p, i) => ({ ...p, __starter: true, __slot: SLOTS[i] })), ...(team?.players?.bench || []).map(p => ({ ...p, __starter: false }))];

// A lineup with an empty starter position (2026-11-24: new accounts with two SG, two PG and no C,
// no bench player for C either, so the game's Auto Lineup failed): the healthy starters, plus
// healthy bench players while fewer than five, are spread over PG SG SF PF C so that as many as
// possible play a position they can, moving as few as possible. null: nothing to fix.
// { short: true, empty }: not five healthy players. Otherwise { starters, bench, empty, text }.
function lineupFix(all) {
  const starters = all.filter(p => isStarter(p));
  const empty = SLOTS.filter(sl => !starters.some(p => slotOf(p) === sl));
  if (!empty.length) return null;
  const five = starters.filter(p => !hurt(p));
  const bench = all.filter(p => !isStarter(p) && !hurt(p));
  // bench players that play an open position first
  bench.sort((x, y) => Number(empty.some(sl => plays(y, sl))) - Number(empty.some(sl => plays(x, sl))));
  while (five.length < 5 && bench.length) five.push(bench.shift());
  if (five.length < 5) return { short: true, empty };
  let best = null;
  const perm = (left, used) => {
    if (used.length === 5) {
      let score = 0;
      used.forEach((p, i) => { if (plays(p, SLOTS[i])) score += 10; if (slotOf(p) === SLOTS[i]) score += 1; });
      if (!best || score > best.score) best = { score, order: [...used] };
      return;
    }
    for (let i = 0; i < left.length; i++) perm([...left.slice(0, i), ...left.slice(i + 1)], [...used, left[i]]);
  };
  perm(five, []);
  const inFive = new Set(best.order);
  const rest = all.filter(p => !inFive.has(p));
  return {
    starters: best.order.map((p, i) => ({ playerId: pid(p), slot: SLOTS[i] })),
    bench: rest.map((p, i) => ({ playerId: pid(p), benchSlot: i + 1 })),
    empty,
    text: best.order.map((p, i) => `${SLOTS[i]} ${p.visualName || p.name}`).join(' · ')
  };
}

// "Cannot start quick play: Missing starter players in positions: C. You need all 5 starter…"
const isMissingStarter = message => /missing starter players in positions/i.test(String(message || ''));

// The guard for every service (set by main): report(accountId, message, source) / waitClear.
let guard = null;
function setGuard(g) { guard = g; }
// A match start was refused with the injury message: true when the account can try again now
// (fixed), false when it has to wait (the guard keeps it; the caller stops retrying).
async function handleInjury(accountId, message, source) {
  // an empty starter position (not an injury, but the same refusal of every match start)
  if (isMissingStarter(message)) return guard ? guard.fillMissing(accountId).catch(() => false) : false;
  if (!isInjuryError(message)) return null;
  if (!guard) return false;
  return guard.report(accountId, message, source).catch(() => false);
}
const injuryBlocked = id => Boolean(guard?.isBlocked(id));
const waitInjuryClear = (id, signal) => (guard ? guard.waitClear(id, signal) : Promise.resolve(true));

class InjuredError extends Error {
  constructor(message) { super(message); this.name = 'InjuredError'; this.injured = true; }
}

module.exports = { InjuryGuard, setGuard, handleInjury, injuryBlocked, waitInjuryClear, isInjuryError, isMissingStarter, lineupFix, rosterRows, injuredNamesOf, planSwaps, InjuredError, ANESTHESIA_ID };
