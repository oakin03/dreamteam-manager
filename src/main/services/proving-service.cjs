const { GameSocket } = require('./game-socket.cjs');
const { isNetError } = require('./game-health.cjs');
const { matchStartSlot } = require('./match-start-gate.cjs');

// Proving Grounds modes against bots, 2 free attempts a day each (read from the game
// client and tried live 2026-10-25):
//
// Daily Boss — /simulation-socket/ acks, reads need only the user id:
//   dailyBoss:getBosses {userId}   -> {success, userLevel, bosses:[{id, name, tier, levelRequired,
//                                      botUser{id}, progress{totalClears, totalAttempts}}]}
//   dailyBoss:getAttempts {userId} -> {success, remaining, max}
//   playDailyBossMatch {userId, bossId, opponentId: botUser.id} (cookie) -> {success, matchId, server}
//
// Elite Ascent (the game calls it "backToPeak") — 300 floors, a win moves one floor up:
//   /socket/ backToPeak:getData -> backToPeak:data {success, data:{floors[]:{floorNumber,
//            enemyUser{id}}, progress{currentFloor, highestFloor, isCompleted}}}
//   /socket/ backToPeak:getAttempts -> backToPeak:attempts {attemptsUsed, attemptsRemaining}
//            (no user id in the payload: these need a `register`ed socket)
//   /simulation-socket/ playBackToPeakMatch {userId, opponentId, floorNumber} (cookie, ack)
// Paid attempts are never bought or used.
//
// A match ends when getUserActiveMatch (/simulation-socket/) no longer returns it.
const SIM_PATH = '/simulation-socket/';
const POLL_MS = 3000;
const APPEAR_GRACE_MS = 20000;
const MATCH_MAX_MS = 15 * 60 * 1000;
const MAX_FAILURES = 3;

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
const NO_ATTEMPTS = /attempt|limit|no more|remaining|already used|daily/i;

class ProvingBase {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now(), timing = {} }, { taskName, prefix, reportKey }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, now, taskName, prefix, reportKey });
    this.onChanged = onChanged || (() => {});
    this.timing = { pollMs: POLL_MS, appearGraceMs: APPEAR_GRACE_MS, matchMaxMs: MATCH_MAX_MS, ...timing };
    this.run = null;
    this.controller = null;
    this.info = {};
  }

  _name(id) { return this.store.getAccounts().find(a => a.id === id)?.name || id; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: this.taskName, code: `${this.prefix}.${code}`, params, message });
  }
  _row(id, patch) { Object.assign(this.run.accounts[id], patch); this.onChanged(); }
  stop() { this.controller?.abort(); }

  snapshot() {
    return { running: Boolean(this.controller), run: this.run ? JSON.parse(JSON.stringify(this.run)) : null, info: { ...this.info }, lastReport: this.store.getSettings?.()?.[this.reportKey] || null };
  }

  async _anonSim(signal) {
    if (this.anonSim?.socket?.connected) return this.anonSim;
    this.anonSim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, signal });
    return this.anonSim;
  }
  _closeAnon() { try { this.anonSim?.close(); } catch {} this.anonSim = null; }
  async _activeMatch(userId, signal) {
    return (await (await this._anonSim(signal)).ack('getUserActiveMatch', { userId }, { signal, timeoutMs: 10000 }))?.match || null;
  }

  // An earlier match (e.g. Auto Play's last one) has to end first.
  async _waitOtherMatch(id, userId, signal) {
    const until = this.now() + this.timing.matchMaxMs;
    let logged = false;
    while (await this._activeMatch(userId, signal)) {
      if (!logged) { this._log(id, 'info', 'waitMatch', {}, 'Already in a match · waiting for it to end'); logged = true; }
      if (this.now() > until) throw new Error('The match did not end in time.');
      this._row(id, { status: 'otherMatch' });
      await sleep(this.timing.pollMs, signal);
    }
  }

  // After a started match: it shows up, then disappears when over.
  async _waitMatchEnd(id, userId, signal) {
    this._row(id, { status: 'playing', matchStartedAt: new Date(this.now()).toISOString() });
    const appear = this.now() + this.timing.appearGraceMs;
    let m = await this._activeMatch(userId, signal);
    while (!m && this.now() < appear) { await sleep(this.timing.pollMs, signal); m = await this._activeMatch(userId, signal); }
    const until = this.now() + this.timing.matchMaxMs;
    while (m) {
      if (this.now() > until) throw new Error('The match did not end in time.');
      await sleep(this.timing.pollMs, signal);
      m = await this._activeMatch(userId, signal);
    }
    await sleep(1500, signal); // results are written right after the match
  }

  async runAndWait(plan, { signal, source = 'manual' } = {}) {
    if (this.controller) throw new Error(`${this.taskName} is already running.`);
    const ids = Object.keys(plan).filter(id => this.store.getAccounts().some(a => a.id === id));
    if (!ids.length) throw new Error('Select at least one account.');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    this.controller = controller;
    this.run = { startedAt: new Date(this.now()).toISOString(), source, accounts: {} };
    for (const id of ids) this.run.accounts[id] = { accountId: id, name: this._name(id), status: 'queued', played: 0, won: 0, lost: 0, left: null, target: plan[id], reason: null, last: null };
    this._log(null, 'info', 'start', { count: ids.length }, `${this.taskName} started · ${ids.length} account(s)`);
    this.onChanged();
    try {
      await Promise.all(ids.map(id => this._safe(id, controller.signal)));
    } finally {
      signal?.removeEventListener('abort', onAbort);
      this._report(controller.signal.aborted);
      this.controller = null;
      this.run = null;
      this._closeAnon();
      this.onChanged();
    }
    if (signal?.aborted) throw abortError();
    return this.snapshot();
  }

  async _safe(id, signal) {
    let retry = false;
    try {
      if (this.gameHealth?.isDown()) { this._row(id, { status: 'waitingGame' }); await this.gameHealth.waitUp(signal); }
      await this._account(id, signal);
    } catch (error) {
      if (error?.name === 'AbortError') { this._row(id, { status: 'stopped', reason: 'stopped' }); return; }
      if (this.gameHealth && isNetError(error)) {
        this.gameHealth.reportDown(this.taskName, error);
        this._row(id, { status: 'waitingGame' });
        retry = true;
      } else {
        if (/auth|session|login/i.test(error.message)) this.sessions.invalidate?.(id);
        this._row(id, { status: 'error', reason: error.message });
        this._log(id, 'error', 'failed', { error: error.message }, `${this.taskName} stopped: ${error.message}`);
      }
    }
    if (retry) {
      try { await this.gameHealth.waitUp(signal); } catch { this._row(id, { status: 'stopped', reason: 'stopped' }); return; }
      return this._safe(id, signal);
    }
  }

  _report(stopped) {
    const final = ['done', 'noAttempts', 'error', 'locked', ...(this.finalStatuses || [])];
    const rows = Object.values(this.run.accounts).map(r => ({ ...r, status: final.includes(r.status) ? r.status : (stopped ? 'stopped' : r.status) }));
    const report = { startedAt: this.run.startedAt, finishedAt: new Date(this.now()).toISOString(), source: this.run.source, rows };
    const settings = this.store.getSettings?.() || {};
    this.store.saveSettings?.({ ...settings, [this.reportKey]: report });
    const played = rows.reduce((n, r) => n + r.played, 0);
    const won = rows.reduce((n, r) => n + r.won, 0);
    const done = rows.filter(r => ['done', 'noAttempts', ...(this.finalStatuses || [])].includes(r.status)).length;
    this._log(null, done === rows.length ? 'success' : 'warning', 'summary', { done, total: rows.length, played, won }, `${this.taskName} result · ${done}/${rows.length} account(s) finished · ${played} match(es) · ${won} won`);
  }
}

class DailyBossService extends ProvingBase {
  constructor(deps) { super(deps, { taskName: 'Daily Boss', prefix: 'bo', reportKey: 'dailyBossReport' }); this.bosses = []; }

  snapshot() { return { ...super.snapshot(), bosses: this.bosses }; }

  async _readBoss(id, userId, signal) {
    const sim = await this._anonSim(signal);
    const b = await sim.ack('dailyBoss:getBosses', { userId }, { signal, timeoutMs: 10000 });
    const a = await sim.ack('dailyBoss:getAttempts', { userId }, { signal, timeoutMs: 10000 });
    if (!b?.success) throw new Error(b?.error || 'Daily Boss list could not be read.');
    this.bosses = (b.bosses || []).map(x => ({ id: x.id, name: x.name, tier: x.tier, levelRequired: Number(x.levelRequired) || 0, botId: x.botUser?.id || null })).sort((p, q) => p.levelRequired - q.levelRequired);
    const clears = Object.fromEntries((b.bosses || []).map(x => [x.id, Number(x.progress?.totalClears) || 0]));
    this.info[id] = { level: Number(b.userLevel) || null, left: a?.success ? Number(a.remaining) : null, max: a?.success ? Number(a.max) : 2, clears, readAt: new Date(this.now()).toISOString() };
    return this.info[id];
  }

  // Level and attempts of every account plus the boss list (no sign-in).
  async status(accountIds) {
    const ids = accountIds || this.store.getAccounts().map(a => a.id);
    try { for (const id of ids) { const u = this._userId(id); if (u) await this._readBoss(id, u).catch(() => null); } }
    finally { if (!this.controller) this._closeAnon(); this.onChanged(); }
    return this.snapshot();
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    let userId = this._userId(id);
    if (!userId) { this._row(id, { status: 'login' }); userId = (await this.sessions.get(account, { owner: 'daily-boss' })).userId; }
    let info = await this._readBoss(id, userId, signal);
    const boss = this.bosses.find(b => b.id === this.run.accounts[id].target);
    if (!boss) throw new Error('Choose a boss for this account.');
    this._row(id, { bossName: boss.name, left: info.left });
    if (info.level != null && info.level < boss.levelRequired) {
      this._row(id, { status: 'locked', reason: `Lv ${boss.levelRequired}` });
      this._log(id, 'warning', 'locked', { boss: boss.name, level: boss.levelRequired }, `${boss.name} needs level ${boss.levelRequired}`);
      return;
    }
    await this._waitOtherMatch(id, userId, signal);
    let sim = null;
    let failures = 0;
    try {
      while (info.left == null || info.left > 0) {
        if (!sim) {
          this._row(id, { status: 'login' });
          const session = await this.sessions.get(account, { owner: 'daily-boss' });
          userId = session.userId;
          sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: session.cookieHeader, signal });
        }
        this._row(id, { status: 'starting' });
        await matchStartSlot(signal, this.timing.startGapMs);
        const r = await sim.ack('playDailyBossMatch', { userId, bossId: boss.id, opponentId: boss.botId }, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.error || r?.message || 'refused');
          if (NO_ATTEMPTS.test(msg)) break;
          failures++;
          this._log(id, 'warning', 'startFailed', { error: msg, n: failures }, `Daily Boss match refused: ${msg}`);
          if (failures >= MAX_FAILURES) throw new Error(msg);
          await this._waitOtherMatch(id, userId, signal);
          await sleep(this.timing.pollMs, signal);
          continue;
        }
        failures = 0;
        const n = this.run.accounts[id].played + 1;
        this._log(id, 'info', 'matchStarted', { n, boss: boss.name }, `Daily Boss match ${n} started · ${boss.name}`);
        const clearsBefore = info.clears[boss.id] || 0;
        await this._waitMatchEnd(id, userId, signal);
        info = await this._readBoss(id, userId, signal);
        const won = (info.clears[boss.id] || 0) > clearsBefore;
        const row = this.run.accounts[id];
        this._row(id, { played: n, won: row.won + (won ? 1 : 0), lost: row.lost + (won ? 0 : 1), left: info.left, last: won ? 'won' : 'lost' });
        this._log(id, won ? 'success' : 'warning', won ? 'matchWon' : 'matchLost', { n, boss: boss.name, result: won ? 'won' : 'lost', left: info.left ?? '?' }, `Daily Boss match ${n} · ${boss.name} · ${won ? 'won' : 'lost'} · ${info.left ?? '?'} attempt(s) left`);
      }
    } finally { try { sim?.close(); } catch {} }
    this._row(id, { status: this.run.accounts[id].played ? 'done' : 'noAttempts', left: 0 });
  }
}

class EliteAscentService extends ProvingBase {
  constructor(deps) { super(deps, { taskName: 'Elite Ascent', prefix: 'ea', reportKey: 'eliteAscentReport' }); }

  // Floors and attempts need a registered /socket/ (an open game tab of the account is signed out).
  async _main(account, signal) {
    const session = await this.sessions.get(account, { owner: 'elite-ascent' });
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    await gs.register(session.userId, { signal, owner: 'Elite Ascent' });
    return { gs, session };
  }

  async _readAscent(id, gs, signal) {
    const d = await gs.call('backToPeak:getData', undefined, 'backToPeak:data', { signal, timeoutMs: 15000 });
    if (!d?.success) throw new Error(d?.error || 'Elite Ascent could not be read.');
    const a = await gs.call('backToPeak:getAttempts', undefined, 'backToPeak:attempts', { signal, timeoutMs: 10000 });
    const p = d.data?.progress || {};
    const floor = Number(p.currentFloor) || 1;
    const next = (d.data?.floors || []).find(f => Number(f.floorNumber) === floor);
    this.info[id] = { floor, highest: Number(p.highestFloor) || null, completed: Boolean(p.isCompleted), left: a?.success ? Number(a.attemptsRemaining) : null, used: a?.success ? Number(a.attemptsUsed) : null, enemyId: next?.enemyUser?.id || null, enemy: next?.enemyUser?.teamName || null, readAt: new Date(this.now()).toISOString() };
    return this.info[id];
  }

  // Signs each account in briefly to read its floor and attempts.
  async status(accountIds) {
    const ids = accountIds || this.store.getAccounts().map(a => a.id);
    for (const id of ids) {
      const account = this.store.getAccounts().find(a => a.id === id);
      if (!account) continue;
      let gs = null;
      try { ({ gs } = await this._main(account)); await this._readAscent(id, gs); } catch {} finally { try { gs?.close(); } catch {} }
    }
    this.onChanged();
    return this.snapshot();
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    this._row(id, { status: 'login' });
    const { gs, session } = await this._main(account, signal);
    const userId = session.userId;
    let sim = null;
    let failures = 0;
    try {
      let info = await this._readAscent(id, gs, signal);
      this._row(id, { left: info.left, floor: info.floor, floorStart: info.floor });
      if (info.completed) { this._row(id, { status: 'done', reason: 'completed' }); return; }
      await this._waitOtherMatch(id, userId, signal);
      sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: session.cookieHeader, signal });
      while (info.left == null || info.left > 0) {
        if (!info.enemyId) throw new Error(`Floor ${info.floor} could not be read.`);
        this._row(id, { status: 'starting', enemy: info.enemy });
        await matchStartSlot(signal, this.timing.startGapMs);
        const r = await sim.ack('playBackToPeakMatch', { userId, opponentId: info.enemyId, floorNumber: info.floor }, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.error || r?.message || 'refused');
          if (NO_ATTEMPTS.test(msg) && !/floor/i.test(msg)) break;
          failures++;
          this._log(id, 'warning', 'startFailed', { error: msg, n: failures }, `Elite Ascent match refused: ${msg}`);
          if (failures >= MAX_FAILURES) throw new Error(msg);
          info = await this._readAscent(id, gs, signal);
          await sleep(this.timing.pollMs, signal);
          continue;
        }
        failures = 0;
        const n = this.run.accounts[id].played + 1;
        const floor = info.floor;
        this._log(id, 'info', 'matchStarted', { n, floor, enemy: info.enemy || '?' }, `Elite Ascent match ${n} started · floor ${floor}`);
        await this._waitMatchEnd(id, userId, signal);
        info = await this._readAscent(id, gs, signal);
        const won = info.floor > floor;
        const row = this.run.accounts[id];
        this._row(id, { played: n, won: row.won + (won ? 1 : 0), lost: row.lost + (won ? 0 : 1), left: info.left, floor: info.floor, last: won ? 'won' : 'lost' });
        this._log(id, won ? 'success' : 'warning', won ? 'matchWon' : 'matchLost', { n, floor, result: won ? 'won' : 'lost', next: info.floor, left: info.left ?? '?' }, `Elite Ascent match ${n} · floor ${floor} · ${won ? 'won' : 'lost'} · now floor ${info.floor} · ${info.left ?? '?'} attempt(s) left`);
        if (info.completed) break;
      }
    } finally {
      try { sim?.close(); } catch {}
      try { gs.close(); } catch {}
    }
    this._row(id, { status: this.run.accounts[id].played ? 'done' : 'noAttempts', left: 0 });
  }
}

// Professional (read from the game client and tried live 2026-10-25). Reads on /socket/ with the
// cookie and the user id in the payload (no register):
//   prof:load {userId} -> professionalUserData {dailyProfessionalMatches (left today),
//        propsRefillsUsed (max 2), profMatchCards, refillsUsed (TIX refills — never used),
//        professionalSeasonCompleted}
//   prof:refillProps {userId} -> refillPropsSuccess / refillPropsError (spends a Prof Match Card)
// Regular season (82 games):
//   season:checkConference -> season:checkConferenceSuccess {conference|null}
//   season:selectConference {userId, conference} -> …Success; season:generateSchedule -> …Success
//   season:loadSchedule -> season:loadScheduleSuccess {schedule[{id, gameNumber, status SCHEDULED|COMPLETED,
//        opponentId, opponent{teamName}, match{winnerId}}]}
//   /simulation-socket/ playProfessionalMatch {userId, opponentId, scheduleId} (ack)
// Playoffs (after the season): season:generatePlayoffs -> …Success; playoff:loadEast / loadWest ->
//   {playoff{brackets[{round, team1{id}, team2{id}, status, games[{id, status, winnerId}]}]}}
//   playProfessionalMatch {…, scheduleId: game.id, matchType: 'PLAYOFF'}; the finals winner
//   (4 wins in NBA_FINALS) goes on to the Hall of Fame.
// Hall of Fame (the user picks the opponent): hof:loadTeams -> hof:loadTeamsSuccess {hofSeason{isCompleted},
//   teams[{teamUserId, displayName, status DEFEATED|…}], attempts{dailyProfessionalMatches}} or
//   hof:loadTeamsError "No active HOF season"; createHOFSeason -> playoff:createHOFSeasonSuccess;
//   /simulation-socket/ playHOFMatch {userId, opponentId: teamUserId, matchType: 'HOF'} (ack).
//   Team strength: getTeamInfo {userId} -> teamInfoData {players{starters, bench}} (offense/defense sums).
// After the HOF (read from the game client 2026-10-25, not tried live): Honor Way (11 teams) and Legacy
// Way (5 teams), played in a fixed order (the lowest "order" not yet beaten):
//   hof:createHonorWaySeason -> hof:createHonorWaySeasonSuccess; honorway:loadTeams -> honorway:loadTeamsSuccess
//        {honorWaySeason{isCompleted}, teams[{teamUserId, displayName, order, status}]}; playHonorWayMatch {…, matchType:'HONOR_WAY'}
//   honorway:createLegacyWaySeason -> …Success; legacyway:loadTeams -> legacyway:loadTeamsSuccess {legacyWaySeason, teams};
//        playLegacyWayMatch {…, matchType:'LEGACY_WAY'}
// Eliminated in the playoffs: playoffs:reset {userId} -> playoffs:resetSuccess (back to the regular season);
// a season with every game played: season:reset -> season:resetSuccess (new conference and schedule).
const PROPS_REFILL_MAX = 2;
const CONFERENCES = ['EAST', 'WEST'];

class ProfessionalService extends ProvingBase {
  constructor(deps) {
    super(deps, { taskName: 'Professional', prefix: 'pf', reportKey: 'professionalReport' });
    this.finalStatuses = ['eliminated', 'champion', 'needPick', 'hofDone', 'legacyDone'];
    this.random = deps.random || Math.random;
    this.strength = {}; // teamUserId -> { off, def, name, at }
  }

  async _read(account, signal) {
    const session = await this.sessions.get(account, { owner: 'professional' });
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    return { gs, session };
  }

  _q(gs, event, payload, ok, signal, timeoutMs = 12000) {
    return gs.call(event, payload, ok, { signal, timeoutMs, errorEvents: ok.endsWith('Success') ? [ok.replace(/Success$/, 'Error')] : [] });
  }

  // Who won a finished season or playoff game (null: not known yet).
  async _winner(gs, userId, stage, gameId, signal) {
    if (stage === 'season') {
      const s = await this._q(gs, 'season:loadSchedule', { userId }, 'season:loadScheduleSuccess', signal).catch(() => null);
      return (s?.schedule || []).find(g => g.id === gameId)?.match?.winnerId || null;
    }
    for (const b of await this._playoffs(gs, userId, signal)) {
      const g = (b.games || []).find(x => x.id === gameId);
      if (g) return g.winnerId || null;
    }
    return null;
  }

  async _prof(gs, userId, signal) {
    const p = await gs.call('prof:load', { userId }, 'professionalUserData', { signal, timeoutMs: 12000 });
    if (!p?.success) throw new Error(p?.error || 'Professional data could not be read.');
    return { left: Number(p.dailyProfessionalMatches) || 0, propsUsed: Number(p.propsRefillsUsed) || 0, cards: Number(p.profMatchCards) || 0, seasonDone: Boolean(p.professionalSeasonCompleted) };
  }

  async _hof(gs, userId, signal) {
    const h = await this._q(gs, 'hof:loadTeams', { userId }, 'hof:loadTeamsSuccess', signal).catch(() => null);
    if (!h || h.success === false || !h.hofSeason) return null;
    return { completed: Boolean(h.hofSeason.isCompleted), teams: (h.teams || []).map(t => ({ id: t.teamUserId, name: t.displayName || '?', defeated: t.status === 'DEFEATED', playable: t.status === 'AVAILABLE' || !t.status })) };
  }

  // The HOF opponent chosen on the page (it can be picked while the run goes on). Without one
  // the account waits while other accounts of the run still play, then ends as "needPick".
  async _waitPick(id, teams, signal) {
    const chosen = () => {
      const pick = this.store.getSettings?.()?.proHofPicks?.[id] || this.run.accounts[id].target;
      return teams.find(t => t.id === pick && t.playable && !t.defeated) || null;
    };
    let logged = false;
    for (;;) {
      const team = chosen();
      if (team) return team;
      if (!logged) { this._row(id, { status: 'needPick' }); this._log(id, 'warning', 'needPick', {}, 'Hall of Fame · choose an opponent'); logged = true; }
      const others = Object.values(this.run.accounts).filter(r => r.accountId !== id && !['done', 'noAttempts', 'error', 'locked', 'stopped', ...this.finalStatuses].includes(r.status));
      if (!others.length) return null;
      await sleep(Math.max(this.timing.pollMs, 2000), signal);
    }
  }

  // Honor Way / Legacy Way: the season and its teams (null when there is none).
  async _way(gs, userId, kind, signal) {
    const ev = kind === 'honor' ? 'honorway' : 'legacyway';
    const h = await this._q(gs, `${ev}:loadTeams`, { userId }, `${ev}:loadTeamsSuccess`, signal).catch(() => null);
    const season = h && h.success !== false ? (kind === 'honor' ? h.honorWaySeason : h.legacyWaySeason) : null;
    if (!season) return null;
    const teams = (h.teams || []).map(t => ({ id: t.teamUserId, name: t.displayName || t.teamUser?.teamName || '?', defeated: t.status === 'DEFEATED', order: Number(t.order) || 0 }));
    const next = teams.filter(t => !t.defeated).sort((a, b) => a.order - b.order)[0] || null;
    return { completed: Boolean(season.isCompleted) || (teams.length > 0 && !next), teams, next };
  }

  async _playoffs(gs, userId, signal) {
    const out = [];
    for (const side of ['East', 'West']) {
      const r = await this._q(gs, `playoff:load${side}`, { userId }, `playoff:load${side}Success`, signal).catch(() => null);
      if (r?.playoff?.brackets) out.push(...r.playoff.brackets);
    }
    return out;
  }

  // Where an account is: season (with the next game), playoffs, champion, eliminated, HOF.
  async _stage(id, gs, userId, signal) {
    const prof = await this._prof(gs, userId, signal);
    const base = { ...prof, readAt: new Date(this.now()).toISOString() };
    for (const kind of ['legacy', 'honor']) {
      const way = await this._way(gs, userId, kind, signal);
      if (!way) continue;
      const stage = kind === 'legacy' ? (way.completed ? 'legacyDone' : 'legacy') : (way.completed ? 'honorDone' : 'honor');
      return (this.info[id] = { ...base, stage, teams: way.teams, defeated: way.teams.filter(t => t.defeated).length, next: way.next && { opponentId: way.next.id, opponent: way.next.name } });
    }
    const hof = await this._hof(gs, userId, signal);
    if (hof) {
      const info = { ...base, stage: hof.completed ? 'hofDone' : 'hof', teams: hof.teams, defeated: hof.teams.filter(t => t.defeated).length };
      if (!hof.completed) await this._rate(gs, info.teams, signal);
      info.teams = info.teams.map(t => ({ ...t, ...(this.strength[t.id] ? { off: this.strength[t.id].off, def: this.strength[t.id].def } : {}) }));
      return (this.info[id] = info);
    }
    if (!prof.seasonDone) {
      const sched = await this._q(gs, 'season:loadSchedule', { userId }, 'season:loadScheduleSuccess', signal).catch(() => null);
      const games = sched?.schedule || [];
      const done = games.filter(g => g.status === 'COMPLETED');
      const next = games.filter(g => g.status === 'SCHEDULED').sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0))[0] || null;
      const won = done.filter(g => g.match?.winnerId === userId).length;
      return (this.info[id] = { ...base, stage: !games.length ? 'noSeason' : next ? 'season' : 'seasonOver', played: done.length, total: games.length, won, lost: done.length - won, next: next && { id: next.id, opponentId: next.opponentId, opponent: next.opponent?.teamName || '?', n: next.gameNumber } });
    }
    const brackets = await this._playoffs(gs, userId, signal);
    if (!brackets.length) return (this.info[id] = { ...base, stage: 'noPlayoffs' });
    const finals = brackets.find(b => b.round === 'NBA_FINALS');
    if (finals) {
      const wins = tid => (finals.games || []).filter(g => g.status === 'COMPLETED' && g.winnerId === tid).length;
      const champ = wins(finals.team1?.id) >= 4 ? finals.team1?.id : wins(finals.team2?.id) >= 4 ? finals.team2?.id : null;
      if (champ) return (this.info[id] = { ...base, stage: champ === userId ? 'champion' : 'eliminated' });
    }
    const mine = b => b.team1?.id === userId || b.team2?.id === userId;
    const order = [finals, ...brackets.filter(b => b.round !== 'NBA_FINALS')].filter(Boolean);
    for (const b of order) {
      if (!mine(b) || b.status === 'COMPLETED') continue;
      const g = (b.games || []).find(x => x.status === 'SCHEDULED');
      if (g) {
        const other = b.team1.id === userId ? b.team2 : b.team1;
        const w = (b.games || []).filter(x => x.status === 'COMPLETED' && x.winnerId === userId).length;
        const l = (b.games || []).filter(x => x.status === 'COMPLETED' && x.winnerId && x.winnerId !== userId).length;
        return (this.info[id] = { ...base, stage: 'playoffs', round: b.round, seriesWon: w, seriesLost: l, next: { id: g.id, opponentId: other.id, opponent: other.teamName || other.name || '?' } });
      }
    }
    return (this.info[id] = { ...base, stage: 'eliminated' });
  }

  // Offense / defense sums of a HOF team (as the game's team card shows them), cached.
  async _rate(gs, teams, signal) {
    for (const t of teams) {
      if (!t.id || this.strength[t.id]) continue;
      const d = await gs.call('getTeamInfo', { userId: t.id }, 'teamInfoData', { signal, timeoutMs: 8000 }).catch(() => null);
      if (!d?.success || !d.players) continue;
      const all = [...(d.players.starters || []), ...(d.players.bench || [])];
      const boost = (p, k) => Object.values(p.equippedItems || {}).reduce((n, it) => n + (Number(it?.[k]) || 0), 0);
      this.strength[t.id] = { off: all.reduce((n, p) => n + (Number(p.offense) || 0) + boost(p, 'offenseBoost'), 0), def: all.reduce((n, p) => n + (Number(p.defense) || 0) + boost(p, 'defenseBoost'), 0), name: d.teamName || t.name };
    }
  }

  // Stage, matches left and (for HOF) the opponents with their strength.
  async status(accountIds) {
    const ids = accountIds || this.store.getAccounts().map(a => a.id);
    for (const id of ids) {
      const account = this.store.getAccounts().find(a => a.id === id);
      if (!account) continue;
      let gs = null;
      try { const r = await this._read(account); gs = r.gs; await this._stage(id, gs, r.session.userId); }
      catch (error) { this.info[id] = { stage: 'error', error: error.message, readAt: new Date(this.now()).toISOString() }; }
      finally { try { gs?.close(); } catch {} }
      this.onChanged();
    }
    return this.snapshot();
  }

  // Champion without a HOF season: create it (the user asked for it on the page).
  async createHof(id) {
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    const { gs, session } = await this._read(account);
    try {
      const r = await gs.call('createHOFSeason', { userId: session.userId }, 'playoff:createHOFSeasonSuccess', { timeoutMs: 20000, errorEvents: ['playoff:createHOFSeasonError'] });
      if (r?.success === false && !/already has an active HOF/i.test(String(r.error))) throw new Error(r.error || 'Hall of Fame could not be created.');
      this._log(id, 'success', 'hofCreated', {}, 'Hall of Fame season created');
      await this._stage(id, gs, session.userId);
    } finally { try { gs.close(); } catch {} this.onChanged(); }
    return this.snapshot();
  }

  // Out of matches: one Prof Match Card refill ("Props", max 2 a day). TIX refills are never used.
  async _refill(id, gs, userId, prof, signal) {
    if (prof.propsUsed >= PROPS_REFILL_MAX || prof.cards <= 0) return false;
    const r = await gs.call('prof:refillProps', { userId }, 'refillPropsSuccess', { signal, timeoutMs: 15000, errorEvents: ['refillPropsError'] });
    if (!r?.success) { this._log(id, 'warning', 'refillFailed', { error: String(r?.error || 'refused') }, `Match card refill refused: ${r?.error || 'refused'}`); return false; }
    this._log(id, 'info', 'refilled', { n: prof.propsUsed + 1, cards: prof.cards - 1 }, `Prof Match Card used · refill ${prof.propsUsed + 1}/${PROPS_REFILL_MAX}`);
    return true;
  }

  // Moves an account past the stages that need no match: new season, playoffs, playoff reset
  // after an elimination, Honor Way after the HOF, Legacy Way after Honor Way.
  async _advance(id, gs, userId, info, signal) {
    const make = async (event, ok, payload, timeoutMs = 30000) => {
      const r = await gs.call(event, payload, ok, { signal, timeoutMs, errorEvents: [ok.replace(/Success$/, 'Error')] });
      if (r?.success === false && !/already has an active/i.test(String(r.error || r.message))) throw new Error(r.error || r.message || `${event} failed.`);
    };
    for (let step = 0; step < 8; step++) {
      if (info.stage === 'noSeason') {
        const c = await this._q(gs, 'season:checkConference', { userId }, 'season:checkConferenceSuccess', signal).catch(() => null);
        if (!c?.conference) {
          const conference = CONFERENCES[Math.floor(this.random() * 2)];
          const s = await this._q(gs, 'season:selectConference', { userId, conference }, 'season:selectConferenceSuccess', signal);
          if (s?.success === false) throw new Error(s.error || 'Conference could not be chosen.');
          this._log(id, 'info', 'conference', { conference }, `New season · conference ${conference}`);
        }
        const g = await this._q(gs, 'season:generateSchedule', { userId }, 'season:generateScheduleSuccess', signal, 30000);
        if (g?.success === false) throw new Error(g.error || 'Schedule could not be created.');
      } else if (info.stage === 'noPlayoffs') {
        const g = await this._q(gs, 'season:generatePlayoffs', { userId }, 'season:generatePlayoffsSuccess', signal, 30000);
        if (g?.success === false) throw new Error(g.error || 'Playoffs could not be created.');
        this._log(id, 'success', 'playoffsReady', {}, 'Season complete · playoffs created');
      } else if (info.stage === 'eliminated') {
        this._log(id, 'warning', 'eliminated', {}, 'Eliminated from the playoffs');
        await make('playoffs:reset', 'playoffs:resetSuccess', { userId });
        this._log(id, 'info', 'playoffReset', {}, 'Playoffs reset · back to the regular season');
      } else if (info.stage === 'seasonOver') {
        await make('season:reset', 'season:resetSuccess', { userId });
        this._log(id, 'info', 'seasonReset', {}, 'Season reset · a new season starts');
      } else if (info.stage === 'hofDone') {
        this._log(id, 'success', 'hofDone', {}, 'Hall of Fame completed');
        await make('hof:createHonorWaySeason', 'hof:createHonorWaySeasonSuccess', { userId });
        this._log(id, 'success', 'honorCreated', {}, 'Honor Way season created');
      } else if (info.stage === 'honorDone') {
        await make('honorway:createLegacyWaySeason', 'honorway:createLegacyWaySeasonSuccess', { userId });
        this._log(id, 'success', 'legacyCreated', {}, 'Honor Way completed · Legacy Way season created');
      } else return info;
      info = await this._stage(id, gs, userId, signal);
    }
    throw new Error(`Professional stage "${info.stage}" could not be passed.`);
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    this._row(id, { status: 'login' });
    const { gs, session } = await this._read(account, signal);
    const userId = session.userId;
    let sim = null;
    let failures = 0;
    try {
      let info = await this._advance(id, gs, userId, await this._stage(id, gs, userId, signal), signal);
      this._row(id, { stage: info.stage, left: info.left });
      for (;;) {
        if (['champion', 'legacyDone'].includes(info.stage)) {
          this._row(id, { status: info.stage });
          this._log(id, 'success', info.stage, {}, { champion: 'Playoffs won · Hall of Fame is next', legacyDone: 'Legacy Way completed' }[info.stage]);
          return;
        }
        let opponent = null;
        let payload;
        if (info.stage === 'hof') {
          opponent = await this._waitPick(id, info.teams, signal);
          if (!opponent) return;
          payload = { userId, opponentId: opponent.id, matchType: 'HOF' };
        } else if (info.next && (info.stage === 'honor' || info.stage === 'legacy')) {
          opponent = { id: info.next.opponentId, name: info.next.opponent };
          payload = { userId, opponentId: opponent.id, matchType: info.stage === 'honor' ? 'HONOR_WAY' : 'LEGACY_WAY' };
        } else if (info.next) {
          opponent = { id: info.next.opponentId, name: info.next.opponent };
          payload = info.stage === 'playoffs' ? { userId, opponentId: opponent.id, scheduleId: info.next.id, matchType: 'PLAYOFF' } : { userId, opponentId: opponent.id, scheduleId: info.next.id };
        } else throw new Error('No game to play was found.');
        if (info.left <= 0) {
          if (!(await this._refill(id, gs, userId, info, signal))) break;
          info = await this._stage(id, gs, userId, signal);
          if (info.left <= 0) break;
          continue;
        }
        await this._waitOtherMatch(id, userId, signal);
        if (!sim) sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: session.cookieHeader, signal });
        this._row(id, { status: 'starting', enemy: opponent.name });
        await matchStartSlot(signal, this.timing.startGapMs);
        const r = await sim.ack({ hof: 'playHOFMatch', honor: 'playHonorWayMatch', legacy: 'playLegacyWayMatch' }[info.stage] || 'playProfessionalMatch', payload, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.error || r?.message || 'refused');
          failures++;
          this._log(id, 'warning', 'startFailed', { error: msg, n: failures }, `Professional match refused: ${msg}`);
          // HOF teams can be beaten only once: an "already beaten" refusal drops that team
          const beaten = ['hof', 'honor', 'legacy'].includes(info.stage) && /defeat|beaten|already/i.test(msg);
          if (failures >= MAX_FAILURES && !beaten) throw new Error(msg);
          info = await this._stage(id, gs, userId, signal);
          if (beaten) { failures = 0; for (const t of info.teams || []) if (t.id === opponent.id) t.defeated = true; }
          await sleep(this.timing.pollMs, signal);
          continue;
        }
        failures = 0;
        const n = this.run.accounts[id].played + 1;
        const stage = info.stage;
        const before = info;
        this._log(id, 'info', 'matchStarted', { n, stage, enemy: opponent.name }, `Professional match ${n} started · ${stage} · ${opponent.name}`);
        await this._waitMatchEnd(id, userId, signal);
        const ladder = ['hof', 'honor', 'legacy'].includes(stage);
        const winner = ladder ? null : await this._winner(gs, userId, stage, before.next.id, signal);
        info = await this._stage(id, gs, userId, signal);
        const beatenNow = () => Boolean(info.teams?.find(t => t.id === opponent.id)?.defeated);
        // the HOF result can show up a little late: read once more before calling it a loss
        if (ladder && info.stage === stage && !beatenNow()) { await sleep(Math.max(this.timing.pollMs, 4000), signal); info = await this._stage(id, gs, userId, signal); }
        const won = ladder ? (info.stage !== stage || beatenNow()) : winner === userId;
        const row = this.run.accounts[id];
        this._row(id, { played: n, won: row.won + (won ? 1 : 0), lost: row.lost + (won ? 0 : 1), left: info.left, stage: info.stage, last: won ? 'won' : 'lost' });
        this._log(id, won ? 'success' : 'warning', won ? 'matchWon' : 'matchLost', { n, stage, enemy: opponent.name, result: won ? 'won' : 'lost', left: info.left }, `Professional match ${n} · ${opponent.name} · ${won ? 'won' : 'lost'} · ${info.left} match(es) left`);
        info = await this._advance(id, gs, userId, info, signal);
      }
    } finally {
      try { sim?.close(); } catch {}
      try { gs.close(); } catch {}
    }
    this._row(id, { status: this.run.accounts[id].played ? 'done' : 'noAttempts', left: 0 });
  }
}

module.exports = { DailyBossService, EliteAscentService, ProfessionalService };
