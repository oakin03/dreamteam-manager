// Tournament level check (user 2026-11-09). An account that registered for a tournament and then
// levelled past its band (e.g. Eithan in 10-19 at level 20) loses its match 25-0 when the
// tournament starts. This check, separate from the registration run:
//  - reads the open tournaments (no sign-in) and the current level of every account,
//  - marks our registered accounts whose level is outside the band (a warning on the page),
//  - when an account of ours fits that tournament and is not in it, swaps them: the wrong one
//    quits (quitMultiplayer) and the fitting one registers right after, so nobody else takes the
//    seat. Both connections are open before the quit. With more wrong accounts than fitting ones
//    the rest stay registered; with more fitting ones they are taken in the account order.
// Only tournaments still in REGISTRATION are touched. Quit is used here and nowhere else.
const { SOCKET_URL, EVENT_SOCKET_PATH, MAIN_SOCKET_PATH, emitAck, waitForConnect, normalizeEvent, fitsLevel } = require('./tournament-service.cjs');

const AUTO_MS = 30 * 60 * 1000;
const LEVEL_PARALLEL = require('./wide.cjs').WIDE; // every account at once (user 2026-11-11)
const READ_TIMEOUT_MS = 12000;

// Which swaps to make. `levels`: userId -> level; `accounts`: [{ id, name, userId }] in order.
function planSwaps(events, accounts, levels) {
  const out = [];
  const used = new Set(); // a fitting account goes into one tournament per check
  for (const event of events.filter(e => e.status === 'REGISTRATION')) {
    const wrong = accounts.filter(a => event.userIds.has(a.userId) && Number.isFinite(levels.get(a.userId)) && !fitsLevel(event, levels.get(a.userId)));
    if (!wrong.length) continue;
    const fit = accounts.filter(a => !event.userIds.has(a.userId) && !used.has(a.id) && fitsLevel(event, levels.get(a.userId)));
    const pairs = [];
    for (let i = 0; i < Math.min(wrong.length, fit.length); i++) { pairs.push({ out: wrong[i], in: fit[i] }); used.add(fit[i].id); }
    out.push({ event, wrong, pairs, stay: wrong.slice(pairs.length) });
  }
  return out;
}

class TournamentLevelService {
  constructor({ store, activity, tournament, onChanged, createSocket, now = () => Date.now() }) {
    Object.assign(this, { store, activity, tournament, createSocket, now });
    this.onChanged = onChanged || (() => {});
    this.state = { busy: false, at: null, rows: [], swaps: [], error: null };
    this.timer = null;
  }

  _settings() { return this.store.getSettings?.() || {}; }
  autoOn() { return this._settings().tournamentLevelAuto !== false; }
  _accounts() {
    const prof = this.store.getAccountProfile?.()?.accounts || {};
    return (this.store.getAccounts?.() || []).filter(a => !a.signupPending && prof[a.id]?.userId).map(a => ({ id: a.id, name: a.name, userId: prof[a.id].userId, account: a }));
  }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? (this._accounts().find(a => a.id === id)?.name || '') : '', taskName: 'Tournament level', code: `tl.${code}`, params, message });
  }
  snapshot() { return { ...JSON.parse(JSON.stringify(this.state)), auto: this.autoOn() }; }
  setAuto(on) { this.store.saveSettings?.({ ...this._settings(), tournamentLevelAuto: Boolean(on) }); this.onChanged(); return this.snapshot(); }

  _socket(path, cookie = null) {
    return this.createSocket(SOCKET_URL, { path, transports: ['websocket'], reconnection: false, ...(cookie ? { withCredentials: true, extraHeaders: { Cookie: cookie } } : {}) });
  }

  async _events() {
    const s = this._socket(EVENT_SOCKET_PATH);
    try {
      await waitForConnect(s);
      const list = await emitAck(s, 'getActiveMultiplayerEvents');
      if (!Array.isArray(list)) throw new Error('Unexpected tournament list reply.');
      return list.map(normalizeEvent);
    } finally { s.close(); }
  }

  // Current level of each account (getMatchUserData, no sign-in), a few at a time.
  async _levels(accounts) {
    const out = new Map();
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(LEVEL_PARALLEL, accounts.length) }, async () => {
      for (let a; (a = accounts[i++]);) {
        const s = this._socket(MAIN_SOCKET_PATH);
        try {
          await waitForConnect(s);
          const level = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { s.off('matchUserData', on); reject(new Error('no level')); }, READ_TIMEOUT_MS);
            const on = d => { if (!d?.success) return; clearTimeout(timer); s.off('matchUserData', on); resolve(Number(d.level)); };
            s.on('matchUserData', on);
            s.emit('getMatchUserData', { userId: a.userId });
          });
          if (Number.isFinite(level)) out.set(a.userId, level);
        } catch {} finally { s.close(); }
      }
    }));
    return out;
  }

  // One check; swaps only when `swap` (the automatic run, or the button).
  async check({ swap = true } = {}) {
    if (this.state.busy) return this.snapshot();
    this.state.busy = true;
    this.state.error = null;
    this.onChanged();
    try {
      const accounts = this._accounts();
      const events = await this._events();
      const ourIds = new Set(accounts.map(a => a.userId));
      const registered = accounts.filter(a => events.some(e => e.status === 'REGISTRATION' && e.userIds.has(a.userId)));
      // levels: every account (the fitting ones are needed too)
      const levels = await this._levels(accounts);
      const plan = planSwaps(events, accounts, levels);
      this.state.rows = plan.map(p => ({
        eventId: p.event.id, name: p.event.name, band: `${p.event.minLevel}-${p.event.maxLevel}`, count: p.event.count, max: p.event.maxPlayers,
        wrong: p.wrong.map(a => ({ id: a.id, name: a.name, level: levels.get(a.userId) })),
        pairs: p.pairs.map(x => ({ out: x.out.name, in: x.in.name, inLevel: levels.get(x.in.userId) })),
        stay: p.stay.map(a => a.name)
      }));
      this.state.checked = { accounts: accounts.length, registered: registered.length, ours: [...ourIds].length, levels: levels.size };
      this.state.at = new Date(this.now()).toISOString();
      this.onChanged();
      const wrongCount = plan.reduce((n, p) => n + p.wrong.length, 0);
      if (wrongCount) this._log(null, 'warning', 'found', { count: wrongCount, events: plan.length }, `Tournament level check · ${wrongCount} registered account(s) above their tournament's level`);
      if (swap) for (const p of plan) for (const pair of p.pairs) await this._swap(p.event, pair, levels);
      return this.snapshot();
    } catch (error) {
      this.state.error = error.message;
      this._log(null, 'error', 'failed', { error: error.message }, `Tournament level check failed: ${error.message}`);
      throw error;
    } finally {
      this.state.busy = false;
      this.onChanged();
    }
  }

  // The wrong account quits and the fitting one registers at once (both sockets ready first).
  async _swap(event, pair, levels) {
    const rec = { at: new Date(this.now()).toISOString(), event: event.name, out: pair.out.name, outLevel: levels.get(pair.out.userId), in: pair.in.name, inLevel: levels.get(pair.in.userId), ok: false, message: '' };
    const sockets = [];
    try {
      const authOut = await this.tournament._login(pair.out.account, new AbortController().signal);
      const authIn = await this.tournament._login(pair.in.account, new AbortController().signal);
      const sOut = this._socket(EVENT_SOCKET_PATH, authOut.cookieHeader); sockets.push(sOut);
      const sIn = this._socket(EVENT_SOCKET_PATH, authIn.cookieHeader); sockets.push(sIn);
      await Promise.all([waitForConnect(sOut), waitForConnect(sIn)]);
      await Promise.all([emitAck(sOut, 'MultiRegistrationJoinRoom', null).catch(() => null), emitAck(sIn, 'MultiRegistrationJoinRoom', null).catch(() => null)]);
      const q = await emitAck(sOut, 'quitMultiplayer', { eventId: event.id, userId: authOut.userId });
      if (!q?.success) { rec.message = `quit refused: ${q?.message || '?'}`; this._log(pair.out.id, 'warning', 'quitFailed', { name: event.name, error: q?.message || '?' }, `${pair.out.name} could not leave ${event.name}: ${q?.message || '?'}`); return; }
      const r = await emitAck(sIn, 'registerMultiplayer', { eventId: event.id, userId: authIn.userId });
      if (r?.success) {
        rec.ok = true;
        event.userIds.delete(authOut.userId); event.userIds.add(authIn.userId);
        this._log(pair.in.id, 'success', 'swapped', { name: event.name, out: pair.out.name, outLevel: rec.outLevel, in: pair.in.name, inLevel: rec.inLevel }, `${event.name}: ${pair.out.name} (Lv ${rec.outLevel}) left, ${pair.in.name} (Lv ${rec.inLevel}) registered`);
      } else {
        rec.message = `register refused: ${r?.message || '?'}`;
        this._log(pair.in.id, 'error', 'registerFailed', { name: event.name, out: pair.out.name, in: pair.in.name, error: r?.message || '?' }, `${event.name}: ${pair.out.name} left but ${pair.in.name} could not register: ${r?.message || '?'}`);
      }
    } catch (error) {
      rec.message = error.message;
      this._log(pair.out.id, 'error', 'swapFailed', { name: event.name, error: error.message }, `${event.name}: swap failed · ${error.message}`);
    } finally {
      for (const s of sockets) { try { s.emit('MultiRegistrationLeaveRoom'); } catch {} try { s.close(); } catch {} }
      this.state.swaps = [rec, ...(this.state.swaps || [])].slice(0, 100);
      this.onChanged();
    }
  }

  start() {
    if (this.timer) return;
    const run = () => { if (this.autoOn() && this.tournament.snapshot?.()?.runtime?.status !== 'running') this.check({ swap: true }).catch(() => {}); };
    this.timer = setInterval(run, AUTO_MS);
    this.timer.unref?.();
    setTimeout(run, 3 * 60 * 1000).unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { TournamentLevelService, planSwaps };
