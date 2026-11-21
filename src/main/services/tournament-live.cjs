const { GameSocket } = require('./game-socket.cjs');

// Turnuva → Canlı (user 2026-11-13): while a tournament runs, every account of ours in it at once.
// Read without signing in, the way the game's tournament page does (checked live 2026-11-13, the
// Friday EXCLUSIVE tournaments):
//   /event-socket/ getActiveMultiplayerEvents (ack) → [{id, name, type, status REGISTRATION|ONGOING…,
//     totalRounds, …Reward1, rewardType1, registrations[{userId}]}]
//   getMultiPlayerEventData {eventId} → event multiPlayerEventData {event, participants[{userId,
//     teamName, level, isBot, eliminatedAt}], currentRound, ongoingMatches[{id, roundNumber, aUserId,
//     bUserId, winnerUserId, aScore, bScore, startedAt, aUser{teamName}, bUser{teamName}}]}
//     (only the matches not finished yet; a 25-0 walkover has its winner and 25-0 from the start)
//   /simulation-socket/ joinMPEventRoom {eventId} → pushes mpRoundTimer {eventId, nextRound,
//     remainingSeconds, message}, mpEventDataChanged; getMPEventMatches {eventId, userId} (ack) →
//     {matches[{match_id, host, opponent, hostName, opponentName, status, mpRound, Server}]}
//   The score itself: joinMatchRoom on /simulation-server-N-socket/ → matchUpdate / matchEnd.
// Results are kept round by round per account for the day.
//
// Auto (user): at 14:54 TR the Auto Play of the picked accounts stops; an account starts again once
// knocked out or when the tournament is over. Rotation: every account in the tournament gets it
// unless the user switched it off for that account (user 2026-11-13, default all).
const TICK_MS = 3000;
const IDLE_MS = 30000;
const STOP_AT = '14:54';

function trClock(ms) {
  const d = new Date(ms + 3 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) };
}
// The reward an account has made sure of so far, from the rounds it won (7 rounds, 128 seats):
// 1 win → top 64, 2–3 → top 32, total−3 → quarter, total−2 → semifinal, total−1 → finalist, all → champion
function rewardFor(e, wins, total = 7) {
  if (!e || !wins) return 0;
  const T = Number(total) || 7;
  const key = wins >= T ? 'champion' : wins === T - 1 ? 'finalist' : wins === T - 2 ? 'semifinal' : wins === T - 3 ? 'quarter' : wins >= 2 ? 'top32' : 'top64';
  return Number(e[key + 'Reward1']) || 0;
}
const isWalkover = (a, b) => (Number(a) === 25 && Number(b) === 0) || (Number(a) === 0 && Number(b) === 25);

class TournamentLive {
  constructor({ store, activity, engine, onChanged, createSocket, gameHealth = null, now = () => Date.now() }) {
    Object.assign(this, { store, activity, engine, createSocket, gameHealth, now });
    // at most one state push a second from here: matchUpdate / mpRoundTimer came several times a
    // second per tournament and the app froze while the tournament ran (user 2026-11-17)
    const push = onChanged || (() => {});
    let pending = null; let lastAt = 0;
    this.onChanged = () => {
      if (pending) return;
      const wait = Math.max(0, 1000 - (Date.now() - lastAt));
      pending = setTimeout(() => { pending = null; lastAt = Date.now(); push(); }, wait);
      pending.unref?.();
    };
    this.uMap = null; this.uMapAt = 0;
    this.events = [];
    this.live = new Map();     // eventId -> { list, data, seconds, nextRound, timerAt, results: Map userId -> Map round -> rec, walkovers: Map }
    this.rooms = new Map();    // server -> GameSocket (match rooms)
    this.joined = new Set();   // match ids joined
    this.matchIndex = new Map(); // match_id -> { eventId, round, host, opponent, hostName, opponentName }
    this.evSock = null; this.simSock = null;
    this.timer = null; this.busy = false; this.lastList = 0;
  }

  _accounts() { return (this.store.getAccounts?.() || []).filter(a => !a.signupPending); }
  _maps() {
    if (this.uMap && this.now() - this.uMapAt < 5000) return this.uMap;
    const prof = this.store.getAccountProfile?.()?.accounts || {};
    const byId = new Map(); const byUser = new Map();
    for (const a of this._accounts()) { const u = prof[a.id]?.userId; if (u) { byId.set(a.id, u); byUser.set(u, a.id); } }
    this.uMap = { byId, byUser }; this.uMapAt = this.now();
    return this.uMap;
  }
  _userId(id) { return this._maps().byId.get(id) || null; }
  _accountOfUser(u) { return this._maps().byUser.get(u) || null; }
  _name(id) { return this._accounts().find(a => a.id === id)?.name || id; }
  _log(level, code, params, message, accountId = null) {
    this.activity.add({ level, accountId, accountName: accountId ? this._name(accountId) : '', taskName: 'Turnuva', code: `tl.${code}`, params, message });
  }
  // settings.tournamentLive = { autoIds: [], rotationOff: [], stopped: {...} }
  _cfg() { return { autoIds: [], rotationOff: [], stopped: null, ...(this.store.getSettings?.()?.tournamentLive || {}) }; }
  _saveCfg(patch) { const s = this.store.getSettings?.() || {}; this.store.saveSettings?.({ ...s, tournamentLive: { ...this._cfg(), ...patch } }); this.onChanged(); }
  setAuto(ids) { this._saveCfg({ autoIds: [...new Set(ids || [])] }); return this.snapshot(); }
  isAuto(id) { return this._cfg().autoIds.includes(id); }
  setRotation(ids, on) { const off = new Set(this._cfg().rotationOff); for (const id of ids || []) (on ? off.delete(id) : off.add(id)); this._saveCfg({ rotationOff: [...off] }); return this.snapshot(); }
  rotationOn(id) { return !this._cfg().rotationOff.includes(id); }

  start() { if (this.timer) return; this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); this.timer = null; this._close(); }
  _close() {
    for (const s of [this.evSock, this.simSock, ...this.rooms.values()]) { try { s?.close(); } catch {} }
    this.evSock = null; this.simSock = null; this.rooms.clear(); this.joined.clear();
  }

  async _ev() { if (!this.evSock || this.evSock.socket?.connected === false) this.evSock = await GameSocket.open({ createSocket: this.createSocket, path: '/event-socket/' }); return this.evSock; }
  async _sim() {
    if (this.simSock && this.simSock.socket?.connected !== false) return this.simSock;
    this.simSock = await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/' });
    const s = this.simSock.socket;
    // a tournament where every account of ours is out (or that is over) is not followed: its pushes are
    // ignored, so its countdown does not keep ticking on the page (user 2026-11-20)
    s.on('mpRoundTimer', d => { const l = this.live.get(d?.eventId); if (!l || l.over || this._doneForUs(l)) return; const changed = l.nextRound !== (d.nextRound ?? null) || l.timerAt == null || Math.abs((l.timerAt + l.seconds * 1000) - (this.now() + Number(d.remainingSeconds) * 1000)) > 3000; l.seconds = Number(d.remainingSeconds); l.nextRound = d.nextRound ?? null; l.message = d.message || null; l.timerAt = this.now(); if (changed) this.onChanged(); });
    s.on('mpEventDataChanged', d => { const l = this.live.get(d?.eventId); if (l && !l.over && !this._doneForUs(l)) this._eventData(d.eventId).catch(() => {}); });
    for (const [id, l] of this.live) if (!l.over && !this._doneForUs(l)) s.emit('joinMPEventRoom', { eventId: id }, () => {});
    return this.simSock;
  }
  // the match rooms of our accounts' matches, one socket per game server
  async _room(server) {
    const key = Number(server) || 1;
    const cur = this.rooms.get(key);
    if (cur && cur.socket?.connected !== false) return cur;
    const gs = await GameSocket.open({ createSocket: this.createSocket, path: `/simulation-server-${key}-socket/` });
    gs.socket.on('matchUpdate', d => this._onMatch(d, false));
    gs.socket.on('matchInitialState', d => this._onMatch(d, false));
    gs.socket.on('matchEnd', d => this._onMatch(d, true));
    this.rooms.set(key, gs);
    for (const [id, m] of this.matchIndex) if ((Number(m.server) || 1) === key && this.joined.has(id)) gs.socket.emit('joinMatchRoom', { matchId: id, userId: `viewer-${Math.random().toString(36).slice(2, 8)}`, teamName: 'viewer', avatarUrl: null });
    return gs;
  }

  _rec(eventId, userId, round) {
    const l = this.live.get(eventId);
    if (!l) return null;
    if (!l.results.has(userId)) l.results.set(userId, new Map());
    const byRound = l.results.get(userId);
    if (!byRound.has(round)) byRound.set(round, { round });
    return byRound.get(round);
  }

  // live score / final result of one of our matches
  _onMatch(d, ended) {
    const id = d?.match_id || d?.matchId;
    const idx = this.matchIndex.get(id);
    if (!idx) return;
    for (const u of [idx.host, idx.opponent]) {
      if (!this._accountOfUser(u)) continue;
      const rec = this._rec(idx.eventId, u, idx.round);
      if (!rec) continue;
      const hostSide = idx.host === u;
      if (ended) {
        const hs = Number(d.hostScore ?? d.hostTeam?.score); const os = Number(d.opponentScore ?? d.opponentTeam?.score);
        if (Number.isFinite(hs) && Number.isFinite(os)) { rec.my = hostSide ? hs : os; rec.their = hostSide ? os : hs; }
        if (d.winner) rec.won = d.winner === u;
        rec.done = true; rec.live = false; rec.quarter = null;
        this._log(rec.won ? 'success' : 'info', rec.won ? 'won' : 'lost', { round: idx.round, score: `${rec.my}-${rec.their}`, opponent: rec.opp || '' }, `Round ${idx.round} ${rec.won ? 'won' : 'lost'} ${rec.my}-${rec.their} vs ${rec.opp || ''}`, this._accountOfUser(u));
      } else if (d.hostTeam && d.opponentTeam) {
        const mine = d.hostTeam.userId === u ? d.hostTeam : d.opponentTeam.userId === u ? d.opponentTeam : (hostSide ? d.hostTeam : d.opponentTeam);
        const theirs = mine === d.hostTeam ? d.opponentTeam : d.hostTeam;
        rec.my = Number(mine.score) || 0; rec.their = Number(theirs.score) || 0;
        rec.quarter = d.quarter ?? null; rec.timeLeft = d.timeLeft ?? null; rec.halftime = Boolean(d.isHalftime);
        rec.live = true; rec.liveAt = this.now();
      }
    }
    this.onChanged();
  }

  async _list() {
    const ev = await this._ev();
    const list = await new Promise((resolve, reject) => ev.socket.timeout(15000).emit('getActiveMultiplayerEvents', (err, r) => (err ? reject(err) : resolve(r))));
    this.events = Array.isArray(list) ? list : (list?.events || []);
    this.lastList = this.now();
  }

  async _eventData(eventId) {
    const ev = await this._ev();
    const d = await ev.call('getMultiPlayerEventData', { eventId }, 'multiPlayerEventData', { timeoutMs: 15000 }).catch(() => null);
    const l = this.live.get(eventId);
    if (!l || !d) return;
    l.data = d; l.at = this.now();
    for (const m of d.ongoingMatches || []) {
      const round = Number(m.roundNumber) || Number(d.currentRound) || 0;
      if (m.winnerUserId && isWalkover(m.aScore, m.bScore)) {
        const winA = m.winnerUserId === m.aUserId;
        l.walkovers.set(m.id, { round, winner: winA ? m.aUser?.teamName : m.bUser?.teamName, loser: winA ? m.bUser?.teamName : m.aUser?.teamName, winnerId: m.winnerUserId, loserId: winA ? m.bUserId : m.aUserId });
      }
      for (const [u, other, my, their] of [[m.aUserId, m.bUser?.teamName, m.aScore, m.bScore], [m.bUserId, m.aUser?.teamName, m.bScore, m.aScore]]) {
        if (!u || !this._accountOfUser(u)) continue;
        const rec = this._rec(eventId, u, round);
        rec.opp = rec.opp || other || null;
        if (m.winnerUserId && isWalkover(m.aScore, m.bScore)) { rec.my = Number(my); rec.their = Number(their); rec.won = m.winnerUserId === u; rec.walkover = true; rec.done = true; rec.fromEvent = true; }
      }
    }
    this.onChanged();
  }

  async _matches(eventId, userId) {
    const sim = await this._sim();
    const r = await sim.ack('getMPEventMatches', { eventId, userId }, { timeoutMs: 8000 }).catch(() => null);
    if (!r?.success || !Array.isArray(r.matches)) return;
    for (const m of r.matches) {
      const ours = [m.host, m.opponent].filter(u => this._accountOfUser(u));
      if (!ours.length || !m.match_id) continue;
      const round = Number(m.mpRound) || 0;
      this.matchIndex.set(m.match_id, { eventId, round, host: m.host, opponent: m.opponent, server: m.Server });
      for (const u of ours) { const rec = this._rec(eventId, u, round); rec.opp = u === m.host ? m.opponentName : m.hostName; rec.matchId = m.match_id; }
      if (!this.joined.has(m.match_id) && m.status !== 'finished') {
        this.joined.add(m.match_id);
        const room = await this._room(m.Server).catch(() => null);
        room?.socket.emit('joinMatchRoom', { matchId: m.match_id, userId: `viewer-${Math.random().toString(36).slice(2, 8)}`, teamName: 'viewer', avatarUrl: null });
      }
    }
    this.onChanged();
  }

  // Every finished match of an account, round by round (the tournament screen's "Match history"):
  //   /event-socket/ getUserEventMatchHistory {userId} (ack) → {matches[{eventName, hostTeam,
  //   opponentTeam, hostScore, opponentScore, isUserHost, userWon, roundNumber, completedAt}]}
  // So the results show from round 1 even when the app was opened later.
  async _history(eventId) {
    const l = this.live.get(eventId);
    if (!l) return;
    const ev = await this._ev();
    const { eachAtOnce } = require('./wide.cjs');
    await eachAtOnce(this.ourIn(l.list), async u => {
      const r = await new Promise(res => ev.socket.timeout(10000).emit('getUserEventMatchHistory', { userId: u }, (err, d) => res(err ? null : d)));
      if (!r?.success) return;
      const day = String(l.list?.startsAt || '').slice(0, 10);
      for (const m of r.matches || []) {
        if (m.eventName !== l.name || (day && String(m.completedAt || '').slice(0, 10) < day)) continue;
        const round = Number(m.roundNumber) || 0;
        const rec = this._rec(eventId, u, round);
        // isUserHost and the score order are not reliable (live 2026-11-13: our own name as the
        // opponent, a won match as 50-112): the opponent is the other name, our score the higher one
        // when we won. A 0-0 row is the match still being played, not a result.
        const me = String(this.store.getAccountProfile?.()?.accounts?.[this._accountOfUser(u)]?.teamName || this._name(this._accountOfUser(u))).toLowerCase();
        const opp = String(m.hostTeam || '').toLowerCase() === me ? m.opponentTeam : String(m.opponentTeam || '').toLowerCase() === me ? m.hostTeam : (m.isUserHost ? m.opponentTeam : m.hostTeam);
        const hi = Math.max(Number(m.hostScore) || 0, Number(m.opponentScore) || 0); const lo = Math.min(Number(m.hostScore) || 0, Number(m.opponentScore) || 0);
        if (!hi && !lo) { rec.opp = rec.opp || opp; continue; }
        const walkover = isWalkover(hi, lo);
        // a 25-0 row's userWon is not reliable (user 2026-11-17: teams that won 25-0 because the
        // opponent was over the level band showed as out): the event data's winner wins; else we won
        // it when we are still in or played a later round
        if (walkover && rec.fromEvent) continue;
        const byRound = l.results.get(u);
        const later = [...(byRound?.values() || [])].some(r => r.round > round && (r.opp || r.done || r.live));
        const p = this._participant(l, u);
        const won = walkover ? (later || (p ? !p.eliminatedAt : Boolean(m.userWon))) : Boolean(m.userWon);
        Object.assign(rec, { opp, my: won ? hi : lo, their: won ? lo : hi, won, done: true, live: false, walkover, at: m.completedAt });
      }
    });
    l.historyAt = this.now();
    this.onChanged();
  }

  ourIn(e) { return (e?.registrations || []).map(r => r.userId).filter(u => this._accountOfUser(u)); }

  async tick() {
    if (this.busy || this.gameHealth?.isDown?.()) return;
    this.busy = true;
    try {
      // a tournament where every account of ours is out is not followed any more (user 2026-11-17)
      const followed = e => { const l = this.live.get(e.id); return !l || !this._doneForUs(l); };
      const running = this.events.some(e => e.status && e.status !== 'REGISTRATION' && this.ourIn(e).length && followed(e));
      if (this.now() - this.lastList > (running ? 10000 : IDLE_MS)) await this._list().catch(() => {});
      const ongoing = this.events.filter(e => e.status && e.status !== 'REGISTRATION' && this.ourIn(e).length);
      await Promise.all(ongoing.map(async e => {
        if (!this.live.has(e.id)) {
          this.live.set(e.id, { id: e.id, name: e.name, type: e.type, totalRounds: e.totalRounds, list: e, data: null, seconds: null, nextRound: null, timerAt: null, message: null, results: new Map(), walkovers: new Map() });
          (await this._sim()).socket.emit('joinMPEventRoom', { eventId: e.id }, () => {});
          await this._eventData(e.id);
          this._log('info', 'following', { name: e.name, count: this.ourIn(e).length }, `Following ${e.name} live · ${this.ourIn(e).length} account(s)`);
        }
        const l = this.live.get(e.id);
        l.list = e;
        if (this._doneForUs(l)) { if (!l.doneLogged) { l.doneLogged = true; l.seconds = null; l.timerAt = null; l.nextRound = null; this._log('info', 'doneForUs', { name: e.name }, `${e.name}: every account of ours is out`); this.onChanged(); } return; }
        await Promise.all([
          this._matches(e.id, this.ourIn(e)[0]).catch(() => {}),
          !l.at || this.now() - l.at > 15000 ? this._eventData(e.id).catch(() => {}) : null,
          !l.historyAt || this.now() - l.historyAt > 30000 ? this._history(e.id).catch(() => {}) : null
        ]);
      }));
      // a finished tournament stays on the page until the end of the day (its results)
      for (const [id, l] of this.live) if (!ongoing.some(e => e.id === id) && !l.over) { l.over = true; this._log('info', 'over', { name: l.name }, `${l.name} is over`); }
      if (!ongoing.some(followed) && (this.simSock || this.rooms.size)) { try { this.simSock.close(); } catch {} this.simSock = null; for (const s of this.rooms.values()) { try { s.close(); } catch {} } this.rooms.clear(); }
      const today = trClock(this.now()).date;
      for (const [id, l] of this.live) if (l.over && trClock(Number(new Date(l.list?.startsAt)) || this.now()).date !== today) this.live.delete(id);
      await this._auto();
    } finally { this.busy = false; }
  }

  // 14:54 TR: the picked accounts' Auto Play stops; each starts again when it is out
  async _auto() {
    const cfg = this._cfg();
    const { date, hm } = trClock(this.now());
    if (cfg.autoIds.length && hm >= STOP_AT && hm < '18:00' && cfg.stopped?.date !== date) {
      const items = [];
      for (const id of cfg.autoIds) {
        const w = this.engine?.workers?.get(id);
        const p = this.engine?.prepared?.get(id);
        const a = w && ['running', 'preparing', 'starting'].includes(w.status) ? w : p;
        if (a) items.push({ accountId: id, taskId: a.taskId, taskName: a.taskName, visibleBrowser: Boolean(a.visibleBrowser), config: a.config || null });
      }
      await this.engine?.stopMany?.(items.map(i => i.accountId), { reason: 'Stopped for the tournament', quiet: true });
      this._saveCfg({ stopped: { date, at: this.now(), items } });
      this._log('info', 'autoStopped', { count: items.length }, `Auto Play stopped for the tournament · ${items.length} account(s)`);
      return;
    }
    const st = cfg.stopped;
    if (!st || st.date !== date || !st.items?.length) return;
    if (hm < '15:01') return;
    const left = [];
    for (const it of st.items) {
      const u = this._userId(it.accountId);
      const inRun = [...this.live.values()].find(l => !l.over && !this._doneForUs(l) && this.ourIn(l.list).includes(u));
      const out = inRun ? this._isOut(inRun, u) : true;
      if (!out) { left.push(it); continue; }
      try {
        const r = await this.engine.startAccount(it.accountId, it.taskId, { visibleBrowser: it.visibleBrowser, forceFresh: false, config: it.config, since: st.at });
        if (!r?.skipped) this._log('success', 'autoResumed', {}, 'Out of the tournament · Auto Play started again', it.accountId);
      } catch (error) { this._log('warning', 'resumeFailed', { error: error.message }, `Auto Play could not start again: ${error.message}`, it.accountId); }
    }
    if (left.length !== st.items.length) this._saveCfg({ stopped: { ...st, items: left } });
  }

  _participant(l, userId) { return (l.data?.participants || []).find(p => p.userId === userId) || null; }
  // The tournament's own participant list says who is out (eliminatedAt). Our round records are only
  // the fallback, and a loss followed by a later round of ours never counts (user 2026-11-17: 25-0
  // winners showed as out and Auto Play started for them)
  _isOut(l, userId) {
    const p = this._participant(l, userId);
    if (p) return Boolean(p.eliminatedAt);
    const recs = [...(l.results.get(userId)?.values() || [])];
    const lost = recs.filter(r => r.done && r.won === false).map(r => r.round);
    if (!lost.length) return false;
    const last = Math.max(...recs.filter(r => r.opp || r.done || r.live).map(r => r.round));
    return lost.includes(last);
  }
  // rounds won so far (25-0 included); while still in, at least the rounds before the current one
  _wins(l, userId) {
    const won = new Set([...(l.results.get(userId)?.values() || [])].filter(r => r.done && r.won === true).map(r => r.round));
    const cur = Number(l.data?.currentRound) || 0;
    return Math.max(won.size, !this._isOut(l, userId) && cur > 1 ? cur - 1 : 0);
  }
  // every account of ours is out: the tournament is over for us
  _doneForUs(l) { const us = this.ourIn(l.list); return us.length > 0 && us.every(u => this._isOut(l, u)); }

  _earned(l, userId) { return rewardFor(l.list, this._wins(l, userId), l.totalRounds || l.list?.totalRounds); }

  _secondsLeft(l) {
    if (l.seconds == null || !l.timerAt) return null;
    return Math.max(0, Math.round(l.seconds - (this.now() - l.timerAt) / 1000));
  }

  rows() {
    const out = [];
    for (const l of this.live.values()) {
      const current = Number(l.data?.currentRound) || null;
      for (const u of this.ourIn(l.list)) {
        const id = this._accountOfUser(u);
        const byRound = l.results.get(u) || new Map();
        const history = [...byRound.values()].sort((a, b) => a.round - b.round).map(r => ({ round: r.round, opp: r.opp || null, my: r.my ?? null, their: r.their ?? null, won: r.won ?? null, walkover: Boolean(r.walkover), noShow: Boolean(r.noShow), done: Boolean(r.done), live: Boolean(r.live && r.liveAt && this.now() - r.liveAt < 15000), quarter: r.live ? r.quarter ?? null : null, timeLeft: r.live ? r.timeLeft ?? null : null }));
        const now = byRound.get(current) || [...byRound.values()].sort((a, b) => b.round - a.round)[0] || null;
        const lostAt = history.find(h => h.done && h.won === false);
        const out_ = this._isOut(l, u);
        out.push({
          accountId: id, userId: u, name: this._name(id), eventId: l.id, event: l.name, totalRounds: l.totalRounds,
          round: now?.round ?? current, opponent: now?.opp || null, score: now?.my ?? null, oppScore: now?.their ?? null,
          quarter: now?.live ? now.quarter : null, timeLeft: now?.live ? now.timeLeft : null, halftime: Boolean(now?.halftime),
          live: Boolean(now?.live && now.liveAt && this.now() - now.liveAt < 15000), done: Boolean(now?.done), won: now?.won ?? null, walkover: Boolean(now?.walkover),
          out: out_, outRound: out_ ? (lostAt?.round ?? null) : null, wins: this._wins(l, u), earned: this._earned(l, u), champion: Boolean(!out_ && l.over), history, rotation: this.rotationOn(id)
        });
      }
    }
    return out;
  }

  snapshot() {
    const cfg = this._cfg();
    return {
      autoIds: cfg.autoIds, rotationOff: cfg.rotationOff, stopped: cfg.stopped, stopAt: STOP_AT,
      events: [...this.live.values()].map(l => ({
        id: l.id, name: l.name, type: l.type, totalRounds: l.totalRounds, over: Boolean(l.over), doneForUs: this._doneForUs(l), ours: this.ourIn(l.list).length, oursLeft: this.ourIn(l.list).filter(u => !this._isOut(l, u)).length,
        round: Number(l.data?.currentRound) || null, nextRound: l.nextRound, secondsLeft: this._secondsLeft(l), endsAt: l.timerAt && l.seconds != null ? l.timerAt + l.seconds * 1000 : null, message: l.message,
        left: (l.data?.participants || []).filter(p => !p.eliminatedAt).length, players: (l.data?.participants || []).length,
        minLevel: l.list?.minLevel ?? null, maxLevel: l.list?.maxLevel ?? null,
        rewardType: l.list?.rewardType1 || null,
        earned: this.ourIn(l.list).reduce((sum, u) => sum + this._earned(l, u), 0),
        earners: this.ourIn(l.list).filter(u => this._earned(l, u) > 0).length,
        walkovers: [...l.walkovers.values()].filter(w => this._accountOfUser(w.winnerId) || this._accountOfUser(w.loserId)).sort((a, b) => a.round - b.round).map(w => ({ ...w, ours: true }))  // only ours (user 2026-11-17)
      })),
      rows: this.rows()
    };
  }
}

module.exports = { TournamentLive, trClock, isWalkover, rewardFor };
