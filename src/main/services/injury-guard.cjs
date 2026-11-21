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
const SETTINGS_DEFAULT = { autoSwap: true, autoHeal: false, healAccounts: [] };

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
  constructor({ store, activity, sessions, createSocket, onChanged, now = () => Date.now(), parallel = WIDE }) {
    Object.assign(this, { store, activity, sessions, createSocket, now, parallel });
    this.onChanged = onChanged || (() => {});
    this.blocked = {};   // accountId -> { names, source, at, lastFixAt, fixing }
    this.teams = {};     // accountId -> { players: [{id, name, position, starter, injured, healed, healedUntil}], anesthesia, readAt, error }
    this.reading = false;
    this.busy = new Set();
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
    return { blocked: JSON.parse(JSON.stringify(this.blocked)), teams: JSON.parse(JSON.stringify(this.teams)), reading: this.reading, busy: [...this.busy], settings: this.settings(), swaps: this._swapsSaved() };
  }
  isBlocked(id) { return Boolean(this.blocked[id]); }

  // --- reading ---------------------------------------------------------------------------
  async _readOne(gs, id) {
    const userId = this._userId(id);
    const team = await gs.ack('getTeamOptimized', { userId }, { timeoutMs: READ_TIMEOUT_MS });
    const all = [...(team?.players?.starters || []).map((p, i) => ({ ...p, __starter: true, __slot: SLOTS[i] })), ...(team?.players?.bench || []).map(p => ({ ...p, __starter: false }))];
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

  shutdown() { clearInterval(this.timer); }
}

// The guard for every service (set by main): report(accountId, message, source) / waitClear.
let guard = null;
function setGuard(g) { guard = g; }
// A match start was refused with the injury message: true when the account can try again now
// (fixed), false when it has to wait (the guard keeps it; the caller stops retrying).
async function handleInjury(accountId, message, source) {
  if (!isInjuryError(message)) return null;
  if (!guard) return false;
  return guard.report(accountId, message, source).catch(() => false);
}
const injuryBlocked = id => Boolean(guard?.isBlocked(id));
const waitInjuryClear = (id, signal) => (guard ? guard.waitClear(id, signal) : Promise.resolve(true));

class InjuredError extends Error {
  constructor(message) { super(message); this.name = 'InjuredError'; this.injured = true; }
}

module.exports = { InjuryGuard, setGuard, handleInjury, injuryBlocked, waitInjuryClear, isInjuryError, injuredNamesOf, planSwaps, InjuredError, ANESTHESIA_ID };
