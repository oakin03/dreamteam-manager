const { GameSocket } = require('./game-socket.cjs');
const { WIDE, eachAtOnce, eachWithSocket } = require('./wide.cjs');

// Cheer (read from the game client 2026-10-23): the live match screen connects to the
// match's simulation server (/simulation-server-<Server>-socket/), joins the room with
//   joinMatchRoom {matchId, userId, teamName, avatarUrl}
// and the two CHEER buttons (one per team) send
//   useCheer(matchId, 'host' | 'opponent', ack) -> {success, message, previousCheer}
// (+5 morale to that team; ~3 cheers a day per cheering account). The target's running
// match comes from /simulation-socket/ getUserActiveMatch {userId}. Only this free
// cheer is used — never the Cheer item from the bag (useCheerProps).
const SIM_PATH = '/simulation-socket/';
const serverPath = n => `/simulation-server-${n}-socket/`;
const TIMEOUT_MS = 12000;
// The game does not report the cheers left, so the app counts them: DAILY_CHEERS a day
// per cheering account, reset at 19:10 TR (UTC+3, no DST). A refusal that mentions a
// limit marks the account as used up for that day.
const DAILY_CHEERS = 3;
const TR_OFFSET_MS = 3 * 3600 * 1000;
const RESET_MS = (19 * 60 + 10) * 60 * 1000;
const LIMIT_RE = /limit|no more|maximum|max\b|daily|today|remaining|run out|out of/i;
// Several targets at once (user 2026-11-09): the cheering accounts take turns over the targets;
// a target gets cheers only from the 2nd half on (quarter 3+) and none once its morale is 200
// (the game's bar: 50 at the start, +5 a cheer, 200 at most). One cheer per account per match.
const MORALE_MAX = 200;
const SECOND_HALF_WAIT_MS = 40 * 60 * 1000;
const PER_MATCH_RE = /already|previous/i;
function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function pause(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const tm = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(tm); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// The "cheer day" a time belongs to: it starts at 19:10 TR.
function cheerDay(ms) { return new Date(ms + TR_OFFSET_MS - RESET_MS).toISOString().slice(0, 10); }
function nextReset(ms) {
  const dayStart = Date.parse(cheerDay(ms) + 'T00:00:00Z') - TR_OFFSET_MS + RESET_MS;
  return dayStart + 24 * 3600 * 1000;
}

class CheerService {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now() }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, now });
    this.onChanged = onChanged || (() => {});
    this.busy = false;
    this.timer = null;
    this.run = null;          // the multi-target run: { status, targets{id:{name,status,quarter,morale,sent}}, ... }
    this.controller = null;
    this.timing = { pollMs: 500, stateWaitMs: 10000, afterCheerMs: 1200, secondHalfWaitMs: SECOND_HALF_WAIT_MS };
    this._armReset();
  }

  // Today's cheer book: { day, counts: { accountId: { used, limited } }, entries: [...], last }.
  _book() {
    const day = cheerDay(this.now());
    const saved = this.store.getCheerReport?.();
    return saved?.day === day ? saved : { day, counts: {}, entries: [], last: null };
  }
  _saveBook(book) { this.store.saveCheerReport?.(book); }
  left(book, id) { const c = book.counts[id]; return c?.limited ? 0 : Math.max(0, DAILY_CHEERS - (c?.used || 0)); }

  // Wakes the page at 19:10 so the table empties by itself.
  _armReset() {
    clearTimeout(this.timer);
    const wait = Math.max(1000, nextReset(this.now()) - this.now() + 1000);
    this.timer = setTimeout(() => { this.onChanged(); this._armReset(); }, Math.min(wait, 2 ** 31 - 1));
    this.timer.unref?.();
  }
  stop() { clearTimeout(this.timer); this.timer = null; }

  snapshot() {
    const book = this._book();
    const left = Object.fromEntries(this.store.getAccounts().map(a => [a.id, this.left(book, a.id)]));
    return { busy: this.busy, run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, day: book.day, resetAt: new Date(nextReset(this.now())).toISOString(), daily: DAILY_CHEERS, left, counts: book.counts, entries: book.entries, last: book.last };
  }

  _account(id) { return this.store.getAccounts().find(a => a.id === id) || null; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? (this._account(id)?.name || '') : '', taskName: 'Cheer', code, params, message });
  }

  async _targetMatch(userId) {
    const sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH });
    try { return (await sim.ack('getUserActiveMatch', { userId }, { timeoutMs: TIMEOUT_MS }))?.match || null; }
    finally { try { sim.close(); } catch {} }
  }

  // One account cheers once for `side` in `match`.
  async _cheerOne(id, match, side) {
    const account = this._account(id);
    const session = await this.sessions.get(account, { owner: 'cheer' });
    const conn = await GameSocket.open({ createSocket: this.createSocket, path: serverPath(match.Server || match.server || 1), cookie: session.cookieHeader });
    try {
      conn.socket.emit('joinMatchRoom', { matchId: match.match_id, userId: session.userId, teamName: account.name, avatarUrl: null });
      await new Promise(r => setTimeout(r, 600));
      const reply = await new Promise((resolve, reject) => {
        conn.socket.timeout(TIMEOUT_MS).emit('useCheer', match.match_id, side, (err, data) => err ? reject(new Error('The game did not answer the cheer.')) : resolve(data));
      });
      return reply;
    } finally {
      try { conn.socket.emit('leaveMatchRoom', { matchId: match.match_id }); } catch {}
      try { conn.close(); } catch {}
    }
  }

  // fromIds cheer for the team of targetId in its current match.
  async cheer(fromIds, targetId) {
    if (this.busy) throw new Error('A cheer is already being sent.');
    const target = this._account(targetId);
    if (!target) throw new Error('Choose the account to cheer for.');
    const ids = (fromIds || []).filter(id => this._account(id));
    if (!ids.length) throw new Error('Select at least one account to cheer with.');
    if (this.gameHealth?.isDown()) throw new Error('The game is not reachable right now; try again shortly.');
    this.busy = true;
    this.onChanged();
    const report = { at: new Date(this.now()).toISOString(), targetId, targetName: target.name, matchId: null, side: null, rows: [], error: null };
    // Today's book (counts per account + log); saved once at the end.
    const book = this._book();
    try {
      let userId = this._userId(targetId);
      if (!userId) userId = (await this.sessions.get(target, { owner: 'cheer' })).userId;
      const match = await this._targetMatch(userId);
      if (!match) {
        report.error = 'noMatch';
        this._log(targetId, 'error', 'ch.noMatch', { target: target.name }, `Cheer: no match found for ${target.name} · nothing was sent`);
        return report;
      }
      const host = match.host || match.hostTeam?.userId;
      const side = host === userId ? 'host' : 'opponent';
      Object.assign(report, { matchId: match.match_id, side, type: match.type || null });
      // every account cheers at once
      await eachAtOnce(ids, async id => {
        const name = this._account(id).name;
        if (this.left(book, id) <= 0) {
          report.rows.push({ accountId: id, name, ok: false, skipped: true, message: 'noCheersLeft' });
          this._log(id, 'warning', 'ch.noneLeft', { target: target.name }, `No cheers left today · skipped`);
          return;
        }
        try {
          const r = await this._cheerOne(id, match, side);
          const ok = Boolean(r?.success);
          const message = r?.message || r?.error || '';
          const count = book.counts[id] || (book.counts[id] = { used: 0, limited: false });
          if (ok) count.used += 1;
          else if (LIMIT_RE.test(message)) count.limited = true;
          report.rows.push({ accountId: id, name, ok, message });
          if (ok) this._log(id, 'success', 'ch.sent', { target: target.name }, `Cheered for ${target.name} (+5 morale)`);
          else this._log(id, 'warning', 'ch.refused', { target: target.name, error: r?.message || r?.error || '?' }, `Cheer for ${target.name} refused: ${r?.message || r?.error || '?'}`);
        } catch (error) {
          report.rows.push({ accountId: id, name, ok: false, message: error.message });
          this._log(id, 'error', 'ch.failed', { target: target.name, error: error.message }, `Cheer for ${target.name} failed: ${error.message}`);
        }
      });
      const ok = report.rows.filter(r => r.ok).length;
      this._log(null, ok === report.rows.length ? 'success' : 'warning', 'ch.summary', { ok, total: report.rows.length, target: target.name }, `Cheer result · ${ok}/${report.rows.length} account(s) cheered for ${target.name}`);
      return report;
    } catch (error) {
      report.error = error.message;
      this._log(null, 'error', 'ch.failed', { target: target.name, error: error.message }, `Cheer failed: ${error.message}`);
      throw error;
    } finally {
      book.last = report;
      const rows = report.rows.map(r => ({ at: report.at, accountId: r.accountId, name: r.name, target: report.targetName, ok: r.ok, message: r.message }));
      if (report.error === 'noMatch') rows.push({ at: report.at, accountId: null, name: '', target: report.targetName, ok: false, message: 'noMatch' });
      book.entries = [...book.entries, ...rows].slice(-300);
      this._saveBook(book);
      this.busy = false;
      this.onChanged();
    }
  }
}

// ---------- several targets: wait for the 2nd half, take turns, stop at 200 morale ----------
CheerService.prototype.stopRun = function stopRun() { this.controller?.abort(); return this.snapshot(); };

CheerService.prototype.start = function start(fromIds, targetIds) {
  if (this.busy) throw new Error('A cheer is already being sent.');
  const targets = [...new Set(targetIds || [])].filter(id => this._account(id));
  if (!targets.length) throw new Error('Choose the account to cheer for.');
  const from = [...new Set(fromIds || [])].filter(id => this._account(id));
  if (!from.length) throw new Error('Select at least one account to cheer with.');
  if (this.gameHealth?.isDown()) throw new Error('The game is not reachable right now; try again shortly.');
  this.busy = true;
  this.controller = new AbortController();
  const signal = this.controller.signal;
  this.run = { status: 'running', at: new Date(this.now()).toISOString(), from, targets: Object.fromEntries(targets.map(id => [id, { name: this._account(id).name, status: 'finding', quarter: null, morale: null, sent: 0 }])) };
  this._log(null, 'info', 'ch.start', { targets: targets.map(id => this._account(id).name).join(', '), count: from.length }, `Cheer started · for ${targets.length} account(s) with ${from.length} account(s)`);
  this.onChanged();
  const book = this._book();
  const used = new Map(); // matchId -> Set(cheerer ids) — one cheer per account per match
  const busyCheerers = new Set();
  let turn = 0;
  // the next cheering account for a match: in turn over the list, with cheers left, not playing
  // in that match, not cheering right now, not used on that match yet
  const take = (matchId, players) => {
    const done = used.get(matchId) || new Set();
    for (let k = 0; k < from.length; k++) {
      const id = from[(turn + k) % from.length];
      if (busyCheerers.has(id) || done.has(id) || this.left(book, id) <= 0 || players.has(this._userId(id))) continue;
      turn = (turn + k + 1) % from.length;
      busyCheerers.add(id);
      return id;
    }
    return null;
  };
  const anyLeft = (matchId, players) => from.some(id => !(used.get(matchId) || new Set()).has(id) && this.left(book, id) > 0 && !players.has(this._userId(id)));
  const set = (id, patch) => { Object.assign(this.run.targets[id], patch); this.onChanged(); };
  const one = async targetId => {
    const target = this._account(targetId);
    const session = await this.sessions.get(target, { owner: 'cheer' });
    const userId = session.userId;
    const match = await this._targetMatch(userId);
    if (!match) {
      set(targetId, { status: 'noMatch' });
      this._log(targetId, 'warning', 'ch.noMatch', { target: target.name }, `Cheer: no match found for ${target.name} · nothing was sent`);
      book.entries.push({ at: new Date(this.now()).toISOString(), accountId: null, name: '', target: target.name, ok: false, message: 'noMatch' });
      return;
    }
    const host = match.host || match.hostTeam?.userId;
    const side = host === userId ? 'host' : 'opponent';
    const players = new Set([match.host, match.opponent, match.hostTeam?.userId, match.opponentTeam?.userId].filter(Boolean));
    const conn = await GameSocket.open({ createSocket: this.createSocket, path: serverPath(match.Server || match.server || 1), cookie: session.cookieHeader, signal });
    let state = null;
    const onState = d => { if (d && (d.hostTeam || d.match)) state = d.hostTeam ? d : d.match; };
    conn.socket.on('matchInitialState', onState);
    conn.socket.on('matchUpdate', onState);
    const morale = () => { const team = state?.hostTeam?.userId === userId ? state.hostTeam : state?.opponentTeam?.userId === userId ? state.opponentTeam : (side === 'host' ? state?.hostTeam : state?.opponentTeam); const m = Number(team?.morale); return Number.isFinite(m) ? m : 50; };
    const ended = () => Boolean(state && (state.status === 'completed' || state.isFinished || state.gameOver || state.winner));
    try {
      conn.socket.emit('joinMatchRoom', { matchId: match.match_id, userId, teamName: target.name, avatarUrl: null });
      for (let waited = 0; !state && waited < this.timing.stateWaitMs; waited += 250) await pause(250, signal);
      if (!state) throw new Error('The match screen did not answer.');
      // the 2nd half: quarter 3 started (halftime over)
      const until = this.now() + this.timing.secondHalfWaitMs;
      while (Number(state.quarter) < 3 || state.isHalftime) {
        if (ended()) { set(targetId, { status: 'ended' }); return; }
        if (this.now() > until) throw new Error('The 2nd half did not start in time.');
        set(targetId, { status: 'waiting2ndHalf', quarter: Number(state.quarter) || 1, morale: morale() });
        await pause(this.timing.pollMs, signal);
      }
      set(targetId, { status: 'cheering', quarter: Number(state.quarter), morale: morale() });
      for (;;) {
        if (morale() >= MORALE_MAX) { set(targetId, { status: 'full', morale: morale() }); this._log(targetId, 'success', 'ch.full', { target: target.name, morale: morale() }, `${target.name}: morale ${morale()} · cheering stops`); return; }
        if (ended()) { set(targetId, { status: 'ended' }); return; }
        if (!anyLeft(match.match_id, players)) { set(targetId, { status: 'noCheerers', morale: morale() }); return; }
        const id = take(match.match_id, players);
        if (!id) { await pause(this.timing.pollMs, signal); continue; }
        const name = this._account(id).name;
        try {
          const r = await this._cheerOne(id, match, side);
          const ok = Boolean(r?.success);
          const message = r?.message || r?.error || '';
          const count = book.counts[id] || (book.counts[id] = { used: 0, limited: false });
          if (!used.has(match.match_id)) used.set(match.match_id, new Set());
          used.get(match.match_id).add(id);
          if (ok) count.used += 1;
          else if (LIMIT_RE.test(message) && !PER_MATCH_RE.test(message)) count.limited = true;
          book.entries.push({ at: new Date(this.now()).toISOString(), accountId: id, name, target: target.name, ok, message });
          if (ok) { this.run.targets[targetId].sent += 1; this._log(id, 'success', 'ch.sent', { target: target.name }, `Cheered for ${target.name} (+5 morale)`); }
          else this._log(id, 'warning', 'ch.refused', { target: target.name, error: message || '?' }, `Cheer for ${target.name} refused: ${message || '?'}`);
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          (used.get(match.match_id) || used.set(match.match_id, new Set()).get(match.match_id)).add(id);
          book.entries.push({ at: new Date(this.now()).toISOString(), accountId: id, name, target: target.name, ok: false, message: error.message });
          this._log(id, 'error', 'ch.failed', { target: target.name, error: error.message }, `Cheer for ${target.name} failed: ${error.message}`);
        } finally { busyCheerers.delete(id); }
        await pause(this.timing.afterCheerMs, signal);
        set(targetId, { morale: morale(), quarter: Number(state.quarter) });
      }
    } finally {
      conn.socket.off('matchInitialState', onState);
      conn.socket.off('matchUpdate', onState);
      try { conn.socket.emit('leaveMatchRoom', { matchId: match.match_id }); } catch {}
      try { conn.close(); } catch {}
    }
  };
  this.done = Promise.all(targets.map(id => one(id).catch(error => {
    if (error?.name === 'AbortError') { this.run.targets[id].status = 'stopped'; return; }
    this.run.targets[id].status = 'error';
    this.run.targets[id].error = error.message;
    this._log(id, 'error', 'ch.failed', { target: this._account(id).name, error: error.message }, `Cheer failed: ${error.message}`);
  }))).finally(() => {
    const sent = Object.values(this.run.targets).reduce((n, x) => n + x.sent, 0);
    this.run.status = signal.aborted ? 'stopped' : 'done';
    this.run.finishedAt = new Date(this.now()).toISOString();
    this._log(null, sent ? 'success' : 'warning', 'ch.runDone', { sent, targets: targets.length }, `Cheer finished · ${sent} cheer(s) for ${targets.length} account(s)`);
    book.entries = book.entries.slice(-300);
    this._saveBook(book);
    this.busy = false;
    this.controller = null;
    this.onChanged();
  });
  return this.snapshot();
};

module.exports = { CheerService, cheerDay, nextReset, DAILY_CHEERS, MORALE_MAX };
