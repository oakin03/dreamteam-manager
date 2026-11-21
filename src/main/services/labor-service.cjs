const { GameSocket } = require('./game-socket.cjs');
const { TradeGameAccount } = require('./trade-game-client.cjs');
const { WIDE, eachWithSocket } = require('./wide.cjs');

// Laborer Contract (user 2026-11-18). Read from the game client (Laborer Contract (Normal) /
// (Special) windows) and checked live without signing in:
//   getPlayerMatchSalaryHistory {playerId} -> playerMatchSalaryHistoryResult
//     {success, salaryRange{min, max, count}}  — anonymous. The game only lets the contract be used
//     with count >= 10 (matches in the last 30 days) and min != max; the new salary is rolled
//     between min and max.
//   useInventoryItem {userId, itemId, playerId, inventoryId: null} -> useInventoryItemResult
//     {success, message}  — on the registered connection of the account that owns the player AND
//     the item.
//   market:getMyPlayerListings {userId, page, search, basePlayersOnly} -> market:myPlayerListingsData
//     {tickets[{id, playerId, price, paymentMode, signedSalary, status, player{...}}]} — anonymous.
// Flow: the chosen player (on one of our teams or our own market listing) is taken off the market
// when listed, traded to the account that has the contract when it is elsewhere, the contract is
// used, and the player joins the Laborer list (Fire / To cards / List, Draft's list, source 'labor').
const READ_TIMEOUT_MS = 12000;
const MIN_MATCHES = 10;
const isLabor = name => /laborer\s*contract/i.test(String(name || ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const n = v => (v == null || v === '' ? null : Number(v));

class LaborService {
  constructor({ store, activity, sessions, createSocket, onChanged, onLaborPlayers = null, now = () => Date.now(), parallel = WIDE }) {
    Object.assign(this, { store, activity, sessions, createSocket, onLaborPlayers, now, parallel });
    this.onChanged = onChanged || (() => {});
    this.candidates = [];   // [{ accountId, playerId, name, rating, position, value, salary, base, where, ticketId, price, currency }]
    this.contracts = {};    // accountId -> [{ itemId, name, quantity }]
    this.readAt = null;
    this.reading = false;
    this.busy = null;       // { playerId, step }
  }

  _accounts() { return (this.store.getAccounts?.() || []).filter(a => !a.signupPending); }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? (this._account(id)?.name || '') : '', taskName: 'Laborer Contract', code: `lc.${code}`, params, message });
  }
  _step(step) { this.busy = { ...(this.busy || {}), step }; this.onChanged(); }

  snapshot() {
    return { contracts: this.contracts, readAt: this.readAt, reading: this.reading, busy: this.busy };
  }

  // Every account's roster, own market listings and contracts, all accounts at once, no sign-in.
  async read() {
    if (this.reading) return { ...this.snapshot(), candidates: this.candidates };
    this.reading = true; this.onChanged();
    const cands = [];
    const contracts = {};
    try {
      const ids = this._accounts().map(a => a.id).filter(id => this._userId(id));
      await eachWithSocket(ids, () => GameSocket.open({ createSocket: this.createSocket }), async (gs, id) => {
        const userId = this._userId(id);
        const inv = await gs.call('getUserInventory', { userId }, 'userInventoryData', { timeoutMs: READ_TIMEOUT_MS });
        const list = Array.isArray(inv) ? inv : (inv?.inventory || inv?.items || []);
        const mine = list.filter(x => isLabor(x?.item?.name) && Number(x.quantity) > 0).map(x => ({ itemId: x.itemId || x.item?.id, name: x.item.name, quantity: Number(x.quantity) || 0 }));
        if (mine.length) contracts[id] = mine;
        const team = await gs.ack('getTeamOptimized', { userId }, { timeoutMs: READ_TIMEOUT_MS });
        for (const p of [...(team?.players?.starters || []), ...(team?.players?.bench || [])]) {
          if (p.isTemporary) continue;
          cands.push({ accountId: id, playerId: p.id, name: p.visualName || p.name, rating: p.rating, position: p.position, value: n(p.baseSalary), salary: n(p.signedSalary), base: n(p.newBaseSalary), where: 'team' });
        }
        const seen = new Set();
        for (let page = 1; page <= 15; page++) {
          const d = await gs.call('market:getMyPlayerListings', { userId, page, search: '', basePlayersOnly: false }, 'market:myPlayerListingsData', { timeoutMs: READ_TIMEOUT_MS });
          const tickets = (d?.tickets || []).filter(t => !seen.has(t.id));
          if (!tickets.length) break;
          for (const t of tickets) {
            seen.add(t.id);
            if (t.status && t.status !== 'LISTED') continue;
            const p = t.player || {};
            cands.push({ accountId: id, playerId: t.playerId || p.id, name: p.visualName || p.name, rating: p.rating, position: p.position, value: n(p.baseSalary), salary: n(t.signedSalary), base: n(p.newBaseSalary), where: 'market', ticketId: t.id, price: n(t.price), currency: t.paymentMode === 'TICKET' ? 'TIX' : 'APK' });
          }
          if (d?.totalPages && page >= d.totalPages) break;
        }
      }, { limit: this.parallel });
      this.candidates = cands;
      this.contracts = contracts;
      this.readAt = new Date(this.now()).toISOString();
    } finally { this.reading = false; this.onChanged(); }
    return { ...this.snapshot(), candidates: this.candidates };
  }

  async range(playerId) {
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const r = await gs.call('getPlayerMatchSalaryHistory', { playerId }, 'playerMatchSalaryHistoryResult', { timeoutMs: READ_TIMEOUT_MS });
      const s = r?.success ? r.salaryRange : null;
      return s ? { min: n(s.min), max: n(s.max), count: n(s.count) || 0, ok: (n(s.count) || 0) >= MIN_MATCHES && n(s.min) !== n(s.max) } : { min: null, max: null, count: 0, ok: false };
    } finally { try { gs.close(); } catch {} }
  }

  // fromAccountId: where the player is now; ticketId: its own market listing (taken off first);
  // toAccountId: the account whose contract is used (the player is traded there when elsewhere).
  async apply({ fromAccountId, playerId, ticketId = null, toAccountId, itemId }) {
    if (this.busy) throw new Error('A contract is already being applied.');
    const from = this._account(fromAccountId), to = this._account(toAccountId);
    if (!from || !to) throw new Error('Account not found.');
    if (!itemId) throw new Error('Choose a contract.');
    const cand = this.candidates.find(c => c.playerId === playerId && c.accountId === fromAccountId) || {};
    const name = cand.name || playerId;
    this.busy = { playerId, step: 'check' }; this.onChanged();
    let f = null, t = null, roomId = null;
    try {
      const rg = await this.range(playerId);
      if (!rg.ok) throw new Error(rg.count < MIN_MATCHES ? `Not enough matches (${rg.count}/${MIN_MATCHES} in the last 30 days).` : 'The salary is the same in every match, nothing to re-roll.');
      t = await TradeGameAccount.open({ account: to, sessions: this.sessions, createSocket: this.createSocket });
      f = fromAccountId === toAccountId ? t : await TradeGameAccount.open({ account: from, sessions: this.sessions, createSocket: this.createSocket });
      if (ticketId) {
        this._step('unlist');
        const r = await f.conn.call('market:cancelPlayerListing', { userId: f.userId, ticketId }, 'cancelResult', { timeoutMs: 20000 }).catch(error => ({ success: false, message: error.message }));
        const back = ((await f.roster().catch(() => null))?.players || {});
        const onTeam = [...(back.starters || []), ...(back.bench || [])].some(p => p.id === playerId);
        if (!r?.success && !onTeam) throw new Error(`Could not be taken off the market: ${r?.message || 'no answer'}`);
        this._log(fromAccountId, 'info', 'unlisted', { name }, `${name} taken off the market`);
      }
      if (fromAccountId !== toAccountId) {
        this._step('trade');
        const password = String(Math.floor(100000 + Math.random() * 900000));
        roomId = await f.createRoom('Contract', password);
        const hostJoined = f.expect('joinedRoomData', d => d?.roomId === roomId);
        const room = await t.joinRoom(roomId, password);
        await hostJoined.catch(() => null);
        const sel = (room.hostPlayers || []).filter(p => p.id === playerId);
        if (!sel.length) throw new Error('The player is not on that account any more.');
        const upd = t.expect('tradeSelectionUpdate', d => d?.roomId === roomId && (d.hostSelectedPlayers || []).length === 1);
        f.select(roomId, sel);
        await upd;
        await sleep(300);
        for (let attempt = 1; ; attempt++) {
          const both = t.expect('acceptTradeUpdate', d => d?.hostAccepted && d?.guestAccepted, 7000);
          f.accept(roomId);
          await sleep(250);
          t.accept(roomId);
          try { await both; break; } catch (error) { if (attempt >= 3) throw error; }
        }
        const resultP = t.expect('tradeResult', () => true).catch(error => ({ success: false, message: error.message }));
        t.confirm(roomId, sel, []);
        const result = await resultP;
        const tr = (await t.roster().catch(() => null))?.players || {};
        if (![...(tr.starters || []), ...(tr.bench || [])].some(p => p.id === playerId)) throw new Error(`Trade failed: ${result?.message || 'the player did not move'}`);
        f.cancelRoom(roomId); roomId = null;
        this._log(toAccountId, 'success', 'traded', { name, from: from.name, to: to.name }, `${name} · ${from.name} → ${to.name}`);
      }
      this._step('use');
      const before = cand.salary;
      const r = await t.conn.call('useInventoryItem', { userId: t.userId, itemId, playerId, inventoryId: null }, 'useInventoryItemResult', { timeoutMs: 20000 }).catch(error => ({ success: false, message: error.message }));
      // the roster decides the new salary (also when the answer got lost)
      await sleep(800);
      const tr = (await t.roster().catch(() => null))?.players || {};
      const p = [...(tr.starters || []), ...(tr.bench || [])].find(x => x.id === playerId) || {};
      const after = n(p.signedSalary);
      if (!r?.success && !(after != null && before != null && after !== before)) throw new Error(`Contract refused: ${r?.message || 'no answer'}`);
      const row = { id: playerId, name: p.visualName || p.name || name, rating: p.rating || cand.rating, position: p.position || cand.position, value: n(p.baseSalary) ?? cand.value, salary: after, salaryBefore: before, base: n(p.newBaseSalary) ?? cand.base, item: (this.contracts[toAccountId] || []).find(c => c.itemId === itemId)?.name || 'Laborer Contract', source: 'labor', at: new Date(this.now()).toISOString(), listed: false };
      this.onLaborPlayers?.(toAccountId, [row]);
      this._log(toAccountId, 'success', 'applied', { name, before: before ?? '?', after: after ?? '?' }, `${name} · salary ${before ?? '?'} → ${after ?? '?'}`);
      // fresh lists: the player moved, a contract was used
      this.candidates = this.candidates.filter(c => c.playerId !== playerId).concat([{ accountId: toAccountId, playerId, name: row.name, rating: row.rating, position: row.position, value: row.value, salary: after, base: row.base, where: 'team' }]);
      const left = (this.contracts[toAccountId] || []).map(c => c.itemId === itemId ? { ...c, quantity: c.quantity - 1 } : c).filter(c => c.quantity > 0);
      if (left.length) this.contracts[toAccountId] = left; else delete this.contracts[toAccountId];
      return { ok: true, before, after, row, candidates: this.candidates };
    } catch (error) {
      this._log(toAccountId, 'error', 'failed', { name, error: error.message }, `${name} · contract failed: ${error.message}`);
      throw error;
    } finally {
      if (roomId) f?.cancelRoom(roomId);
      try { t?.leave(); } catch {}
      if (f && f !== t) f.close();
      t?.close();
      this.busy = null; this.onChanged();
    }
  }
}

module.exports = { LaborService, isLabor };
