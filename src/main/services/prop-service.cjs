const { GameSocket } = require('./game-socket.cjs');

// Stamina props at halftime (read from the game client 2026-10-25). The live match is on
// /simulation-server-<Server>-socket/: after `joinMatchRoom {matchId, userId, teamName, avatarUrl}`
// it sends matchInitialState / matchUpdate with { quarter (1–4, 5 = OT), isHalftime,
// halftimeCountdown, hostTeam / opponentTeam: { userId, starters[{id, name, stamina}],
// inventory[{id (inventory id), quantity, item{id, name, staminaRestore}}] } }.
// Props can only be used during the 20 s halftime:
//   updatePlayerStamina {matchId, playerId, staminaRestore, userId, inventoryId, itemName} (ack)
// Single-player stamina items (the game's own list): Water Bottle Small (+10), Medium (+30),
// Large. Team items are never used. The bag (no sign-in): /socket/ getUserInventory {userId}
// -> userInventoryData [{itemId, quantity, item?}].
const SIM_PATH = '/simulation-socket/';
const serverPath = n => `/simulation-server-${n}-socket/`;
const SMALL = 'cmeuwyoyn0000kw6dybh50gq1';   // Water Bottle (Small), +10
const MEDIUM = 'cmeuwyoyn0001kw6domi4mjg0';  // Water Bottle (Medium), +30
const LARGE = 'cmeuwyoyn0002kw6d3fyk95w2';   // Water Bottle (Large) — not used
const RESTORE = { [SMALL]: 10, [MEDIUM]: 30, [LARGE]: 50 };
const TARGET = 95;          // fill every starter to 95+
const MEDIUM_MAX = 85;      // a +30 only at 85 or below (+10s first)
const WAIT_HALFTIME_MS = 20 * 60 * 1000;
const TIMEOUT_MS = 8000;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

// Which prop a starter gets next (or null): +10 first; +30 only when ≤ 85 and no +10 left.
function nextProp(stamina, left) {
  if (stamina >= TARGET) return null;
  if (left[SMALL] > 0) return SMALL;
  if (left[MEDIUM] > 0 && stamina <= MEDIUM_MAX) return MEDIUM;
  return null;
}

class PropService {
  constructor({ store, activity, sessions, onChanged, createSocket, now = () => Date.now() }) {
    Object.assign(this, { store, activity, sessions, createSocket, now });
    this.onChanged = onChanged || (() => {});
    this.runs = {};   // accountId -> { status, quarter, countdown, used{small,medium}, players[], message }
    this.bags = {};   // accountId -> { small, medium, large, readAt }
    this.controllers = new Map();
  }

  snapshot() { return { runs: JSON.parse(JSON.stringify(this.runs)), bags: { ...this.bags }, busy: [...this.controllers.keys()] }; }
  _account(id) { return this.store.getAccounts().find(a => a.id === id) || null; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id, accountName: this._account(id)?.name || '', taskName: 'Props', code, params, message });
  }
  _set(id, patch) { this.runs[id] = { ...(this.runs[id] || {}), ...patch }; this.onChanged(); }
  stop(id) { this.controllers.get(id)?.abort(); }

  // Props left in every bag (no sign-in).
  async bagsOf(accountIds) {
    const ids = accountIds || this.store.getAccounts().map(a => a.id);
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      for (const id of ids) {
        const userId = this._userId(id);
        if (!userId) continue;
        const d = await gs.call('getUserInventory', { userId }, 'userInventoryData', { timeoutMs: TIMEOUT_MS }).catch(() => null);
        const list = Array.isArray(d) ? d : (d?.inventory || d?.items || []);
        const q = itemId => list.filter(x => (x.itemId || x.item?.id) === itemId).reduce((n, x) => n + (Number(x.quantity) || 0), 0);
        if (Array.isArray(list)) this.bags[id] = { small: q(SMALL), medium: q(MEDIUM), large: q(LARGE), readAt: new Date(this.now()).toISOString() };
      }
    } finally { try { gs.close(); } catch {} }
    this.onChanged();
    return this.snapshot();
  }

  // One account: find its match, wait for halftime, fill its starters, report, leave.
  async run(id) {
    if (this.controllers.has(id)) throw new Error('Props are already being used for this account.');
    const account = this._account(id);
    if (!account) throw new Error('Account not found.');
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this._set(id, { status: 'finding', startedAt: new Date(this.now()).toISOString(), used: { small: 0, medium: 0 }, players: [], message: null, quarter: null, countdown: null });
    this._go(id, account, controller.signal)
      .catch(error => {
        if (error?.name === 'AbortError') { this._set(id, { status: 'stopped' }); return; }
        this._set(id, { status: 'error', message: error.message });
        this._log(id, 'error', 'pr.failed', { error: error.message }, `Props: ${error.message}`);
      })
      .finally(() => { this.controllers.delete(id); this.onChanged(); this.bagsOf([id]).catch(() => {}); });
    return this.snapshot();
  }

  async _go(id, account, signal) {
    const session = await this.sessions.get(account, { owner: 'props' });
    const userId = session.userId;
    const sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, signal });
    let match;
    try { match = (await sim.ack('getUserActiveMatch', { userId }, { signal, timeoutMs: TIMEOUT_MS }))?.match || null; } finally { try { sim.close(); } catch {} }
    if (!match) {
      this._set(id, { status: 'noMatch' });
      this._log(id, 'warning', 'pr.noMatch', {}, 'The team is not in a match · no props used');
      return;
    }
    const conn = await GameSocket.open({ createSocket: this.createSocket, path: serverPath(match.Server || match.server || 1), cookie: session.cookieHeader, signal });
    const sock = conn.socket;
    let state = null;
    const onState = d => { if (d && (d.hostTeam || d.match)) state = d.hostTeam ? d : d.match; };
    sock.on('matchInitialState', onState);
    sock.on('matchUpdate', onState);
    try {
      sock.emit('joinMatchRoom', { matchId: match.match_id, userId, teamName: account.name, avatarUrl: null });
      const until = this.now() + WAIT_HALFTIME_MS;
      // wait for the first state
      for (let i = 0; !state && i < 40; i++) await pause(250, signal);
      if (!state) throw new Error('The match screen did not answer.');
      // quarters 3 and 4 (and overtime): the halftime is over
      if (!state.isHalftime && Number(state.quarter) >= 3) {
        this._set(id, { status: 'late', quarter: Number(state.quarter) });
        this._log(id, 'warning', 'pr.late', { quarter: Number(state.quarter) }, `The match is in quarter ${state.quarter} · halftime is over, props can only be used at halftime`);
        return;
      }
      if (!state.isHalftime) {
        this._set(id, { status: 'waitingHalftime', quarter: Number(state.quarter) || null });
        this._log(id, 'info', 'pr.waiting', { quarter: Number(state.quarter) || 1 }, `Quarter ${state.quarter || 1} · waiting for halftime`);
        while (!state.isHalftime) {
          if (this.now() > until) throw new Error('Halftime did not come.');
          if (Number(state.quarter) >= 3) { this._set(id, { status: 'late' }); this._log(id, 'warning', 'pr.missed', {}, 'Halftime passed before props could be used'); return; }
          this._set(id, { quarter: Number(state.quarter) || null });
          await pause(200, signal);
        }
      }
      await this._fill(id, match.match_id, userId, () => state, conn, signal);
    } finally {
      sock.off('matchInitialState', onState);
      sock.off('matchUpdate', onState);
      try { sock.emit('leaveMatchRoom', { matchId: match.match_id }); } catch {}
      try { conn.close(); } catch {}
    }
  }

  async _fill(id, matchId, userId, current, conn, signal) {
    const s = current();
    const mine = s.hostTeam?.userId === userId ? s.hostTeam : s.opponentTeam;
    const bag = mine?.inventory || [];
    const entry = itemId => bag.find(x => (x.item?.id || x.itemId) === itemId);
    const left = { [SMALL]: Number(entry(SMALL)?.quantity) || 0, [MEDIUM]: Number(entry(MEDIUM)?.quantity) || 0 };
    const restore = itemId => Number(entry(itemId)?.item?.staminaRestore) || RESTORE[itemId];
    const players = (mine?.starters || []).map(p => ({ id: p.id, name: p.visualName || p.name || '?', start: Math.round(Number(p.stamina) || 0), stamina: Math.round(Number(p.stamina) || 0), small: 0, medium: 0 }));
    this._set(id, { status: 'using', countdown: s.halftimeCountdown ?? null, players, bagSmall: left[SMALL], bagMedium: left[MEDIUM] });
    this._log(id, 'info', 'pr.halftime', { count: players.length }, `Halftime · filling ${players.length} starters to ${TARGET}+`);
    const used = { small: 0, medium: 0 };
    for (const p of players) {
      for (;;) {
        if (signal.aborted) throw abortError();
        if (!current().isHalftime) break;
        const itemId = nextProp(p.stamina, left);
        if (!itemId) break;
        const e = entry(itemId);
        const r = await conn.ack('updatePlayerStamina', { matchId, playerId: p.id, staminaRestore: restore(itemId), userId, inventoryId: e?.id, itemName: e?.item?.name || (itemId === SMALL ? 'Water Bottle (Small)' : 'Water Bottle (Medium)') }, { signal, timeoutMs: TIMEOUT_MS }).catch(error => ({ success: false, error: error.message }));
        if (!r?.success) {
          const msg = String(r?.error || r?.message || 'refused');
          if (/wait|cooldown|too fast|slow/i.test(msg)) { await pause(300, signal); continue; }
          if (/halftime|only/i.test(msg)) break;
          this._log(id, 'warning', 'pr.refused', { name: p.name, error: msg }, `${p.name}: prop refused · ${msg}`);
          break;
        }
        left[itemId] -= 1;
        p.stamina = Math.min(100, p.stamina + restore(itemId));
        if (itemId === SMALL) { p.small++; used.small++; } else { p.medium++; used.medium++; }
        const live = current();
        this._set(id, { used: { ...used }, players: players.map(x => ({ ...x })), countdown: live.halftimeCountdown ?? null, bagSmall: left[SMALL], bagMedium: left[MEDIUM] });
      }
    }
    // stamina as the game sees it now
    const after = current();
    const team = after.hostTeam?.userId === userId ? after.hostTeam : after.opponentTeam;
    for (const p of players) { const g = (team?.starters || []).find(x => x.id === p.id); if (g && Number.isFinite(Number(g.stamina))) p.stamina = Math.round(Number(g.stamina)); }
    const low = players.filter(p => p.stamina < TARGET).map(p => `${p.name} ${p.stamina}`);
    this._set(id, { status: 'done', used, players, finishedAt: new Date(this.now()).toISOString() });
    this._log(id, low.length ? 'warning' : 'success', 'pr.done', { small: used.small, medium: used.medium, low: low.join(', ') || '—' },
      `Props used · ${used.small} × +10 · ${used.medium} × +30${low.length ? ` · below ${TARGET}: ${low.join(', ')}` : ' · every starter at 95+'}`);
  }
}

function pause(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = { PropService, nextProp, SMALL, MEDIUM };
