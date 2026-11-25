const { GameSocket } = require('./game-socket.cjs');
const { eachAtOnce } = require('./wide.cjs');

// Rotasyon (user 2026-11-13): during the matches of the game modes (not Auto Play's PK) the app
// rotates the players and uses the timeouts by the user's own plan, and switches tactics.
//
// Live (verified 2026-11-13, no browser, one socket per match):
//   /simulation-socket/ getUserActiveMatch {userId} (ack, anonymous) -> {match{match_id, type, Server}}
//   /simulation-server-N-socket/ joinMatchRoom {matchId, userId, teamName} (cookie of the account)
//     -> matchInitialState / matchUpdate {quarter, timeLeft "mm:ss", isHalftime, timeouts{userId: n},
//        userCooldowns, hostTeam/opponentTeam{userId, score, starters[], bench[], strategies{offense,
//        defense}}}; player: {id, slot, benchSlot, stamina, fouls, position (initial state)}
//   updatePlayers(matchId, starters[], bench[], userId): a substitution (full lists with the slots);
//     another one only ~5 s later; during a timeout any number
//   useTimeout(matchId, userId): 3 per match, +5 stamina for everyone; halftime gives +10
//   setActiveStrategyLiveStat {userId, matchId, strategyType, strategy{...isActive}}
//
// The user's plan:
//   Q1: nothing. Q2, shortly after it starts: the starters ("aces") go out one by one, most tired
//   first, every ~6 s, each replaced by the bench player that fits its slot (best position fit over
//   the whole lineup: a SG/SF goes to SF when a pure SG is there too). From Q3: a timeout when the
//   highest stamina on the court is 95 or less; the same for the second; the last one when the
//   fittest ace on the bench reaches 95, and in that timeout every ace comes back to its own slot.
//   No bench: timeouts only, never in the first half (props may be used at halftime). Fouls ignored.
//   The match always ends with the aces. Tactics: when not far behind and not winning easily, our
//   defense switches to the one that beats their offense, our offense to the one that beats their
//   defense (one at a time, both in a timeout).
const SCAN_MS = 8000;
const SUB_GAP_MS = 6000;
const STRATEGY_GAP_MS = 6500;
const TIMEOUT_GAP_MS = 15000;
const Q2_START_AFTER_S = 15;          // seconds into Q2 before the first substitution
// Q4: aces back at the latest this many game seconds before the end. The game clock runs ~13×
// faster than real time (Q2's 5 substitutions took ~24 s), so this is a few real seconds only.
const ACE_BACK_LATE_S = 240;
// The aces come back ONE BY ONE, never all at once (user 2026-11-21: a whole lineup changing in the
// same instant looks like a bot). In a timeout (the game clock stops ~4 s real, no sub cooldown)
// they are spread over TIMEOUT_WINDOW_MS; outside a timeout one per SUB_GAP_MS, so late in Q4 the
// return starts LATE_PER_ACE_S game seconds earlier for every ace still on the bench.
const TIMEOUT_WINDOW_MS = 3200;
const LATE_PER_ACE_S = 90;
const FAR_BEHIND = 15;
const EASY_LEAD = 10;
const MODE_OF_TYPE = {
  MP: 'tournament', PROFESSIONAL: 'professional', HOF: 'professional', HONOR_WAY: 'professional', LEGACY_WAY: 'professional', PLAYOFF: 'professional',
  TOWER_CHALLENGER: 'tower', TOWER_THREAT: 'tower', TOWER_RIVAL: 'tower', BACK_TO_PEAK: 'ascent', GOUP: 'goup', DAILY_BOSS: 'boss',
  MAGIC_TEAM: 'magic', PVP: 'pvp', PVP_ARENA: 'pvp', PVPARENA: 'pvp'
};
const MODES = ['tournament', 'professional', 'tower', 'ascent', 'goup', 'boss', 'magic', 'pvp'];
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'];
const GROUP = { PG: 'G', SG: 'G', SF: 'F', PF: 'F', C: 'B' };

const secondsOf = t => { const m = String(t || '').match(/(\d+):(\d+)/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const positionsOf = p => String(p?.position || '').toUpperCase().split('/').map(s => s.trim()).filter(Boolean);
// how well a player fits a slot: his first position 3, the second 2, the same group 1
function fit(position, slot) {
  const ps = positionsOf({ position });
  if (ps[0] === slot) return 3;
  if (ps.includes(slot)) return 2;
  if (ps.some(x => GROUP[x] && GROUP[x] === GROUP[slot])) return 1;
  return 0;
}
// bench players → ace slots, the best total fit (ties: the more tired slots first)
function assignBench(slots, bench, tiredness = {}) {
  let best = null;
  const order = [...slots].sort((a, b) => (tiredness[b] || 0) - (tiredness[a] || 0));
  const walk = (i, used, pairs, score) => {
    if (i === bench.length || pairs.length === order.length) {
      const tie = pairs.reduce((n, p) => n + (tiredness[p.slot] || 0), 0);
      if (!best || score > best.score || (score === best.score && tie > best.tie)) best = { score, tie, pairs: [...pairs] };
      if (i === bench.length) return;
    }
    const b = bench[i];
    for (const slot of order) if (!used.has(slot)) { used.add(slot); pairs.push({ slot, id: b.id }); walk(i + 1, used, pairs, score + fit(b.position, slot)); pairs.pop(); used.delete(slot); }
    walk(i + 1, used, pairs, score); // this bench player not used
  };
  walk(0, new Set(), [], 0);
  return best ? best.pairs : [];
}

class Controller {
  constructor(mgr, { accountId, name, userId, match, mode }) {
    Object.assign(this, { mgr, accountId, name, userId, match, mode });
    this.gs = null;
    this.state = null;
    this.positions = new Map();   // player id -> position
    this.aces = null;             // slot -> player id (the starting five)
    this.plan = null;             // [{slot, id}] bench player for an ace slot
    this.lastSubAt = 0; this.lastTimeoutAt = 0; this.lastStrategyAt = 0;
    this.subs = 0; this.timeoutsUsed = 0; this.strategyChanges = 0;
    this.acesBack = false;
    this.busy = false;
    this.ended = false;
    this.note = 'connecting';
  }

  // Watching starts at once on an anonymous socket (no sign in needed); the writes need the
  // account's session socket, opened next to it. The session could take minutes when many
  // accounts sign in together (Daily Boss of 141 accounts, 2026-11-13: joined in halftime),
  // so the match is followed meanwhile and the actions start as soon as the writer is there.
  async attach() {
    const path = `/simulation-server-${this.match.Server || 1}-socket/`;
    const room = { matchId: this.match.match_id, userId: this.userId, teamName: this.name, avatarUrl: null };
    this.gs = await GameSocket.open({ createSocket: this.mgr.createSocket, path });
    const tickNow = () => this.tick().catch(e => this._log('warning', 'error', { error: e.message }, `Rotation: ${e.message}`));
    // the joining snapshot can be old (it said Q3 12:00 in Q4): learn from it, act on updates
    this.gs.socket.on('matchInitialState', d => { this._onState({ ...d, quarter: this.state?.quarter ?? d?.quarter, timeLeft: this.state?.timeLeft ?? d?.timeLeft }); });
    this.gs.socket.on('matchUpdate', d => { if (this._onState(d)) tickNow(); });
    this.gs.socket.on('matchEnd', () => this.end('ended'));
    this.gs.socket.on('disconnect', () => { if (!this.ended) this.note = 'disconnected'; });
    this.gs.socket.emit('joinMatchRoom', room);
    this.note = 'watching';
    this._log('info', 'attached', { mode: this.mode }, `Rotation on · ${this.mode} match`);
    this.mgr._strategies(this.userId).then(s => { this.strategies = s; }).catch(() => {});
    (async () => {
      const session = await this.mgr.sessions.get(this.mgr._account(this.accountId), { owner: 'rotation' });
      if (this.ended) return;
      const ws = await GameSocket.open({ createSocket: this.mgr.createSocket, path, cookie: session.cookieHeader });
      if (this.ended) { try { ws.close(); } catch {} return; }
      ws.socket.on('substitutionError', e => this._log('warning', 'subError', { error: e?.message || e?.error || '' }, `Substitution refused: ${e?.message || e?.error || ''}`));
      ws.socket.emit('joinMatchRoom', room);
      this.ws = ws;
    })().catch(error => this._log('warning', 'attachFailed', { error: error.message }, `Rotation could not join the match: ${error.message}`));
  }

  _emit(...args) { (this.ws || this.gs).socket.emit(...args); }

  end(why = 'ended') {
    if (this.ended) return;
    this.ended = true;
    if (why === 'ended') this.mgr.finished?.add(this.match.match_id);
    try { this.gs?.close(); } catch {}
    try { this.ws?.close(); } catch {}
    if (why === 'ended') this._log('success', 'done', { subs: this.subs, timeouts: this.timeoutsUsed, strategies: this.strategyChanges }, `Rotation done · ${this.subs} substitution(s), ${this.timeoutsUsed} timeout(s), ${this.strategyChanges} tactic change(s)`);
    this.mgr._drop(this.accountId, this);
  }

  // An update merges into the state. isHalftime is taken from each update as it comes: the updates
  // after halftime leave the key out, and a kept `true` stopped everything from Q3 on (2026-11-13).
  _onState(d) {
    if (!d || !(d.hostTeam || d.opponentTeam)) return false;
    this.state = { ...(this.state || {}), ...d, isHalftime: Boolean(d.isHalftime) };
    this._learn(d);
    return true;
  }

  _log(level, code, params, message) { this.mgr._log(level, code, params, message, this.accountId); }
  _mine(s = this.state) { return s?.hostTeam?.userId === this.userId ? s.hostTeam : s?.opponentTeam; }
  _theirs(s = this.state) { return s?.hostTeam?.userId === this.userId ? s.opponentTeam : s?.hostTeam; }
  _learn(d) {
    for (const t of [d.hostTeam, d.opponentTeam]) for (const p of [...(t?.starters || []), ...(t?.bench || [])]) if (p?.position) this.positions.set(p.id, p.position);
    const mine = this._mine(d);
    // Every field ever seen of our players (the initial state has the full player: position,
    // ratings…; an update only id, stamina, fouls, slot and stats). updatePlayers must get the full
    // players like the game client sends them: the stripped ones made the server count our team
    // as 760/760 for the rest of the match (2026-11-13, lost 43-110).
    this.full ||= new Map();
    for (const p of [...(mine?.starters || []), ...(mine?.bench || [])]) if (p?.id) this.full.set(p.id, { ...(this.full.get(p.id) || {}), ...p });
    if (!this.aces && mine?.starters?.length) this.aces = Object.fromEntries(mine.starters.filter(p => p.slot).map(p => [p.slot, p.id]));
  }

  async tick() {
    if (this.busy || this.ended || !this.ws || this.mgr.isOff(this.accountId)) return;
    const s = this.state; const mine = this._mine(); const theirs = this._theirs();
    if (!s || !mine || s.isHalftime) return;
    this.busy = true;
    try {
      const q = Number(s.quarter) || 0;
      const left = secondsOf(s.timeLeft);
      const now = this.mgr.now();
      const myTimeouts = Number(s.timeouts?.[this.userId] ?? 0);
      const court = mine.starters || [];
      const bench = (mine.bench || []).map(p => ({ ...p, position: this.positions.get(p.id) }));
      const stam = p => Number(p?.stamina ?? 100);
      const aceIds = new Set(Object.values(this.aces || {}));
      const benchAces = (mine.bench || []).filter(p => aceIds.has(p.id));
      this.note = `Q${q} ${s.timeLeft || ''}`;
      // ---- Q2: rotate the aces out one by one, most tired first
      // props asked (user 2026-11-13): only the starting five get them, so no Q2 rotation and the
      // aces go back on court before halftime (the game sends nothing during halftime)
      if (this.propsWanted && !this.acesBack && q <= 2) {
        if (benchAces.length && now - this.lastSubAt >= SUB_GAP_MS) { if (!(await this._oneAceBack())) this._log('info', 'propsAces', {}, 'Rotation: props asked · the aces are back on court'); return; }
        if (!benchAces.length) this.acesBack = true;
      }
      if (q === 2 && left != null && left <= 12 * 60 - Q2_START_AFTER_S && !this.acesBack && !this.propsWanted) {
        if (!this.plan) {
          const benchFresh = bench.filter(p => !aceIds.has(p.id));
          const tired = Object.fromEntries(court.map(p => [p.slot, 100 - stam(p)]));
          this.plan = assignBench(Object.keys(this.aces || {}), benchFresh, tired);
        }
        const todo = this.plan.filter(p => court.some(c => c.slot === p.slot && aceIds.has(c.id)) && bench.some(b => b.id === p.id));
        if (todo.length && now - this.lastSubAt >= SUB_GAP_MS) {
          const next = todo.sort((a, b) => stam(court.find(c => c.slot === a.slot)) - stam(court.find(c => c.slot === b.slot)))[0];
          await this._swap([{ slot: next.slot, inId: next.id }]);
          return;
        }
      }
      // ---- from Q3: the timeouts (never in the first half)
      if (q >= 3 && myTimeouts > 0 && now - this.lastTimeoutAt >= TIMEOUT_GAP_MS) {
        const rotated = benchAces.length > 0;
        const lastOne = myTimeouts === 1;
        if (rotated && lastOne) {
          if (Math.max(...benchAces.map(stam)) >= 95) { await this._timeout('aces'); await this._acesBack(TIMEOUT_WINDOW_MS); return; }
        } else if (court.length && Math.max(...court.map(stam)) <= 95) {
          await this._timeout('stamina');
          return;
        }
      }
      // ---- the match always ends with the aces
      if (benchAces.length && !this.acesBack && q >= 4 && left != null && (this.lateReturn || left <= ACE_BACK_LATE_S + benchAces.length * LATE_PER_ACE_S)) {
        // once started it goes on until every ace is back (the window shrinks as the bench empties)
        this.lateReturn = true;
        if (now - this.lastSubAt >= SUB_GAP_MS) { await this._oneAceBack(); return; }
      }
      // ---- tactics
      await this._tactics(mine, theirs);
    } finally { this.busy = false; }
  }

  // one or more players in: [{slot, inId}] (the player in that slot goes to the bench)
  async _swap(moves, { counted = moves.length } = {}) {
    const mine = this._mine();
    const whole = p => ({ ...(this.full?.get(p.id) || {}), ...p });
    const starters = (mine.starters || []).map(whole); const bench = (mine.bench || []).map(whole);
    // like the game client's swapPlayers: the two swap places in the arrays and the slot moves;
    // benchSlot is left as it is
    for (const m of moves) {
      const si = starters.findIndex(p => p.slot === m.slot);
      const bi = bench.findIndex(p => p.id === m.inId);
      if (si < 0 || bi < 0) continue;
      const out = starters[si], inn = bench[bi];
      if (Number(inn.fouls) >= 6) continue;
      inn.slot = m.slot; out.slot = null;
      starters[si] = inn; bench[bi] = out;
    }
    this._emit('updatePlayers', this.match.match_id, starters, bench, this.userId);
    this.lastSubAt = this.mgr.now();
    this.subs += counted;
    this._log('info', 'sub', { count: counted, quarter: this.state.quarter, time: this.state.timeLeft }, `Rotation: ${counted} substitution(s) · Q${this.state.quarter} ${this.state.timeLeft}`);
  }

  async _timeout(why) {
    this._emit('useTimeout', this.match.match_id, this.userId);
    this.lastTimeoutAt = this.mgr.now();
    this.timeoutsUsed += 1;
    this._log('info', 'timeout', { why, quarter: this.state.quarter, time: this.state.timeLeft }, `Rotation: timeout (${why}) · Q${this.state.quarter} ${this.state.timeLeft}`);
    await this._sleep(400);
  }

  _sleep(ms) { return this.mgr.sleep ? this.mgr.sleep(ms) : new Promise(r => setTimeout(r, ms)); }

  // The moves one at a time over `windowMs`. Every send carries the latest state plus every move so
  // far: if the server's update has not come in yet, the earlier player is not put back by mistake.
  async _swapInTurn(moves, windowMs) {
    const gap = moves.length > 1 ? Math.floor(windowMs / (moves.length - 1)) : 0;
    for (let i = 0; i < moves.length; i++) {
      if (this.ended) return;
      if (i) await this._sleep(gap);
      await this._swap(moves.slice(0, i + 1), { counted: 1 });
    }
  }

  // the aces on the bench and the slot each one goes back to
  _aceMoves() {
    const mine = this._mine();
    return Object.entries(this.aces || {}).filter(([slot, id]) => !(mine.starters || []).some(p => p.slot === slot && p.id === id) && (mine.bench || []).some(p => p.id === id)).map(([slot, id]) => ({ slot, inId: id }));
  }

  // outside a timeout: one ace back (the most rested first); returns how many are still on the bench
  async _oneAceBack() {
    if (!this.aces) return 0;
    const moves = this._aceMoves();
    if (!moves.length) { this.acesBack = true; return 0; }
    const stamina = id => Number((this._mine().bench || []).find(p => p.id === id)?.stamina ?? 0);
    const next = [...moves].sort((a, b) => stamina(b.inId) - stamina(a.inId))[0];
    await this._swap([next]);
    if (moves.length === 1) this.acesBack = true;
    return moves.length - 1;
  }

  // every ace back to its own slot during a timeout: one by one, all within the timeout
  async _acesBack(windowMs = TIMEOUT_WINDOW_MS) {
    if (!this.aces) return;
    const moves = this._aceMoves();
    if (!moves.length) { this.acesBack = true; return; }
    await this._swapInTurn(moves, windowMs);
    this.acesBack = true;
  }

  async _tactics(mine, theirs) {
    if (!this.strategies || !theirs) return;
    const now = this.mgr.now();
    if (now - this.lastStrategyAt < STRATEGY_GAP_MS) return;
    const diff = (Number(mine.score) || 0) - (Number(theirs.score) || 0);
    if (diff < -FAR_BEHIND || diff >= EASY_LEAD) return;
    const their = theirs.strategies || {};
    const ours = mine.strategies || {};
    const counter = (list, beatName) => (list || []).filter(x => x.learned !== false && (x.beats || []).includes(beatName));
    const tryOne = async (type, list, theirsName) => {
      if (!theirsName) return false;
      const cur = ours[type]?.name;
      const options = counter(list, theirsName);
      if (!options.length || options.some(o => o.name === cur)) return false;
      const pick = options.sort((a, b) => (b.scale || 1) - (a.scale || 1))[0];
      this._emit('setActiveStrategyLiveStat', { userId: this.userId, matchId: this.match.match_id, strategyType: type, strategy: { ...pick, isActive: true } });
      this.lastStrategyAt = now;
      this.strategyChanges += 1;
      this._log('info', 'strategy', { type, name: pick.name, vs: theirsName }, `Rotation: ${type} tactic → ${pick.name} (beats ${theirsName})`);
      return true;
    };
    if (await tryOne('defense', this.strategies.defense, their.offense?.name)) return;
    await tryOne('offense', this.strategies.offense, their.defense?.name);
  }

  view() {
    const s = this.state, mine = this._mine(), theirs = this._theirs();
    return { accountId: this.accountId, name: this.name, mode: this.mode, matchId: this.match.match_id, type: this.match.type, quarter: s?.quarter ?? null, timeLeft: s?.timeLeft ?? null, halftime: Boolean(s?.isHalftime), score: mine?.score ?? null, oppScore: theirs?.score ?? null, opponent: theirs?.teamName || null, timeoutsLeft: s?.timeouts?.[this.userId] ?? null, subs: this.subs, timeoutsUsed: this.timeoutsUsed, strategies: this.strategyChanges, acesBack: this.acesBack, note: this.note, off: this.mgr.isOff(this.accountId) };
  }
}

class MatchControl {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, allowed = () => true, roleOf = () => 'side', isDummyRole = () => false, now = () => Date.now() }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, allowed, roleOf, isDummyRole, now });
    this.onChanged = onChanged || (() => {});
    this.controllers = new Map();   // accountId -> Controller
    this.offFor = new Map();        // accountId -> matchId the user switched off
    this.propsFor = new Set();      // accounts whose next / running match gets props
    this.finished = new Set();      // match ids that ended (the game lists them as active a little longer)
    this.unknownTypes = new Set();
    this.timer = null;
    this.scanning = false;
    this.strategyCache = new Map();
  }

  _accounts() { return (this.store.getAccounts?.() || []).filter(a => !a.signupPending); }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(level, code, params, message, accountId = null) {
    this.activity.add({ level, accountId, accountName: accountId ? (this._account(accountId)?.name || '') : '', taskName: 'Rotasyon', code: `rt.${code}`, params, message });
  }
  // settings.rotationModes: { tournament: true, … } (every mode on by default)
  modes() { const m = this.store.getSettings?.()?.rotationModes || {}; return Object.fromEntries(MODES.map(k => [k, m[k] !== false])); }
  setMode(mode, on) {
    if (!MODES.includes(mode)) throw new Error('Unknown mode.');
    const s = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...s, rotationModes: { ...(s.rotationModes || {}), [mode]: Boolean(on) } });
    if (!on) for (const c of [...this.controllers.values()]) if (c.mode === mode) c.end('off');
    this.onChanged();
    return this.snapshot();
  }
  // Which accounts a mode rotates, by account role (user 2026-11-25): every role is on except the
  // Dummy role; settings.rotationRoles[mode] = { roleId: true | false } keeps the user's choices.
  roleOn(mode, roleId) {
    const o = this.store.getSettings?.()?.rotationRoles?.[mode] || {};
    return Object.prototype.hasOwnProperty.call(o, roleId) ? Boolean(o[roleId]) : !this.isDummyRole(roleId);
  }
  accountOn(mode, accountId) { return this.roleOn(mode, this.roleOf(accountId)); }
  setRole(mode, roleId, on) {
    if (!MODES.includes(mode)) throw new Error('Unknown mode.');
    const s = this.store.getSettings?.() || {};
    const all = { ...(s.rotationRoles || {}) };
    all[mode] = { ...(all[mode] || {}), [roleId]: Boolean(on) };
    this.store.saveSettings?.({ ...s, rotationRoles: all });
    for (const c of [...this.controllers.values()]) if (c.mode === mode && !this.accountOn(mode, c.accountId)) c.end('off');
    this.onChanged();
    return this.snapshot();
  }

  // the user switches one account off for its current match
  stopAccount(accountId) {
    const c = this.controllers.get(accountId);
    if (c) { this.offFor.set(accountId, c.match.match_id); c.end('off'); this._log('info', 'stopped', {}, 'Rotation stopped for this match', accountId); }
    this.onChanged();
    return this.snapshot();
  }
  // Props on this account's match: the controller keeps the aces on court (see tick)
  forProps(accountId) {
    this.propsFor.add(accountId);
    const c = this.controllers.get(accountId);
    if (c) c.propsWanted = true;
    return true;
  }
  isOff(accountId) { const c = this.controllers.get(accountId); return Boolean(c && this.offFor.get(accountId) === c.match.match_id); }
  _drop(accountId, c) { if (this.controllers.get(accountId) === c) this.controllers.delete(accountId); this.onChanged(); }

  async _strategies(userId) {
    const hit = this.strategyCache.get(userId);
    if (hit && this.now() - hit.at < 10 * 60 * 1000) return hit.data;
    const gs = await GameSocket.open({ createSocket: this.createSocket });
    try {
      const r = await gs.call('getUserStrategies', { userId }, 'userStrategies', { timeoutMs: 10000 });
      const data = { offense: r?.offense || [], defense: r?.defense || [] };
      this.strategyCache.set(userId, { at: this.now(), data });
      return data;
    } finally { gs.close(); }
  }

  snapshot() {
    // per mode the role ids that rotate (the page lists the roles from the account role list)
    const roleIds = [...new Set(['main', 'main2', 'side', ...(this.store.getSettings?.()?.accountRoleDefs || []).map(d => d.id)])];
    const roles = Object.fromEntries(MODES.map(m => [m, roleIds.filter(r => this.roleOn(m, r))]));
    return { modes: this.modes(), roles, live: [...this.controllers.values()].map(c => c.view()), unknownTypes: [...this.unknownTypes] };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.scan().catch(() => {}), SCAN_MS);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; for (const c of [...this.controllers.values()]) c.end('stop'); }

  // every account's running match (anonymous); a match of an enabled mode gets a controller
  async scan() {
    if (this.scanning || this.gameHealth?.isDown?.()) return;
    const modes = this.modes();
    if (!Object.values(modes).some(Boolean)) return;
    this.scanning = true;
    let sim = null;
    try {
      sim = await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/' });
      const ids = this._accounts().map(a => a.id).filter(id => this._userId(id));
      await eachAtOnce(ids, async id => {
        const userId = this._userId(id);
        const m = (await sim.ack('getUserActiveMatch', { userId }, { timeoutMs: 8000 }).catch(() => null))?.match || null;
        const cur = this.controllers.get(id);
        if (!m || m.status !== 'started') { if (cur && !cur.ended) cur.end('ended'); return; }
        if (cur && cur.match.match_id === m.match_id) return;
        if (this.finished.has(m.match_id)) return;
        if (this.finished.size > 500) this.finished.clear();
        if (cur) cur.end('ended');
        const mode = MODE_OF_TYPE[m.type];
        if (!mode) { if (m.type !== 'PK' && m.type !== 'FM' && m.type !== 'GROUP' && !this.unknownTypes.has(m.type)) { this.unknownTypes.add(m.type); this._log('info', 'unknownType', { type: m.type }, `Match type ${m.type} is not covered by rotation`, id); } return; }
        if (!modes[mode] || !this.accountOn(mode, id) || !this.allowed(id, mode) || this.offFor.get(id) === m.match_id) return;
        const c = new Controller(this, { accountId: id, name: this._account(id)?.name || id, userId, match: m, mode });
        if (this.propsFor.delete(id)) c.propsWanted = true;
        this.controllers.set(id, c);
        c.attach().catch(error => { this._log('warning', 'attachFailed', { error: error.message }, `Rotation could not join the match: ${error.message}`, id); c.end('fail'); });
      });
    } finally {
      try { sim?.close(); } catch {}
      this.scanning = false;
      this.onChanged();
    }
  }
}

module.exports = { MatchControl, Controller, assignBench, fit, secondsOf, MODE_OF_TYPE, MODES };
