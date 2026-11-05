const { GameSocket } = require('./game-socket.cjs');
const { ProvingBase } = require('./proving-service.cjs');
const { matchStartSlot } = require('./match-start-gate.cjs');

// The Office of the city (game update 2026-11-05, read from the game client), all /socket/ with
// the user id in the payload:
//
// Coach — getCoachState {userId} -> event coachState {coaches[8]{id, name, offense, defense},
//   selectedCoachId, cards{master, change}, tickets, today{used, free, max, nextTicketCost},
//   training{startedAt, endsAt}|null, config{durationMs, minLevel 'SUPERFINE', maxXp}}
//   selectCoach {userId, coachId} (ack; the first coach is free, a change costs a Change Coach Card)
//   startCoachTraining {userId} (ack; 1 Strategy Master Card, 3 h, +20 XP to both strategies of the
//     coach when SUPERFINE or above; attempts past today.free cost tickets -> never used)
//   claimCoachTraining {userId} (ack, after endsAt)
//
// Big Three — big3:getTeams {userId} -> teams[30]{id, team, playerId1..3, bonusOffense, bonusDefense,
//   ownsTrio, level}; big3:getUserProgress {userId, big3TeamId} -> {progress{level, xp, availablePoints,
//   offenseBonus, defenseBonus, trainingStart, trainingEnd}, levelCap 15, magic{status, claimedAt}};
//   big3:getTrainingAttempts {userId} -> attemptsRemaining (3 normal a day), intensive (tickets -> never);
//   big3:getActiveTraining, big3:getUserActiveBig3Type -> BIG3|SUPERBIG3|null.
//   big3:startTraining {userId, big3TeamId, useIntensive:false} (300 skill XP / 3 h), big3:finishTraining
//   (free once the time is over; early = tickets -> never), big3:upgradeBonus {…, bonusType},
//   big3:activate {userId}, big3:deactivate {userId}. A trio past level 15 trains with magic:* (after the
//   Magic Team prize of the Proving Grounds).
//
// Strategies — getUserStrategies {userId} -> event userStrategies {offense[], defense[]} each {id, name, description,
//   learned, level BASE..MASTER, experience, isActive, matchBoost, beats[], losesTo[], learnCost}.
//
// My Super Lineup (Super Big 3, own trio from the roster) — superBig3:getUserProgress {userId} -> {progress{id,
//   level, xp, availablePoints, offenseBonus, defenseBonus, trainingStart, trainingEnd}, playerInfo[3]};
//   superBig3:getUserPlayers {userId} -> players (the roster); superBig3:updatePlayers {userId, superBig3Id, playerIds[3]}
//   (creates it; a change resets ALL its progress); superBig3:getTrainingAttempts, superBig3:startTraining {userId,
//   superBig3Id, useIntensive:false}, superBig3:finishTraining, superBig3:upgradeBonus {…, bonusType},
//   superBig3:activate {userId, superBig3Id}, superBig3:deactivate {userId}.
const TIMEOUT_MS = 12000;
const AUTO_MS = 10 * 60 * 1000;
const AUTH = /auth|user id is required|not authenticated|unauthor/i;
const LEVELS = ['BASE', 'PRIMARY', 'SUPERIOR', 'EXPERT', 'SUPERFINE', 'MASTER'];

function trainable(strategy) { return Boolean(strategy?.trainable) && !strategy?.maxed; }

class OfficeService {
  constructor({ store, activity, sessions, onChanged, createSocket, gameHealth = null, now = () => Date.now(), autoMs = AUTO_MS }) {
    Object.assign(this, { store, activity, sessions, createSocket, gameHealth, now, autoMs });
    this.onChanged = onChanged || (() => {});
    this.info = {};       // accountId -> { coach, big3, readAt, error }
    this.busy = new Set();
    this.timer = null;
  }

  _accounts() { return this.store.getAccounts?.() || []; }
  _account(id) { return this._accounts().find(a => a.id === id) || null; }
  _name(id) { return this._account(id)?.name || id; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? this._name(id) : '', taskName: 'Office', code: `of.${code}`, params, message });
  }
  _auto() { const s = this.store.getSettings?.() || {}; return { coach: Array.isArray(s.officeCoachAuto) ? s.officeCoachAuto : [], big3: s.officeBig3Auto && typeof s.officeBig3Auto === 'object' ? s.officeBig3Auto : {}, superBig3: Array.isArray(s.officeSuperAuto) ? s.officeSuperAuto : [] }; }

  snapshot() { return { info: JSON.parse(JSON.stringify(this.info)), busy: [...this.busy], auto: this._auto() }; }

  // A connection for this account: another service's registered one if live, else the cookie;
  // `register` only when the game asks for it.
  async _open(account, signal) {
    const session = await this.sessions.get(account, { owner: 'office' });
    const borrowed = GameSocket.borrow?.(session.userId);
    if (borrowed) return { gs: borrowed, userId: session.userId, own: false, registered: true };
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    return { gs, userId: session.userId, own: true, registered: false };
  }
  _close(c) { if (c?.own) { try { c.gs.close(); } catch {} } }
  async _ack(c, event, payload, signal) {
    let r = await c.gs.ack(event, payload, { signal, timeoutMs: TIMEOUT_MS });
    if (!r?.success && AUTH.test(String(r?.error || r?.message || '')) && c.own && !c.registered) {
      await c.gs.register(c.userId, { signal, owner: 'Office' });
      c.registered = true;
      r = await c.gs.ack(event, payload, { signal, timeoutMs: TIMEOUT_MS });
    }
    return r;
  }
  async _coachState(c, signal) {
    let r = await c.gs.call('getCoachState', { userId: c.userId }, 'coachState', { signal, timeoutMs: TIMEOUT_MS, errorEvents: ['coachStateError', 'coachError'] }).catch(e => ({ success: false, error: e.message }));
    if ((r?.success === false || !r?.coaches) && c.own && !c.registered) {
      await c.gs.register(c.userId, { signal, owner: 'Office' });
      c.registered = true;
      r = await c.gs.call('getCoachState', { userId: c.userId }, 'coachState', { signal, timeoutMs: TIMEOUT_MS, errorEvents: ['coachStateError', 'coachError'] });
    }
    if (!r?.coaches) throw new Error(r?.error || r?.message || 'Coach could not be read.');
    return r;
  }

  _coachView(s) {
    const coach = (s.coaches || []).find(c => c.id === s.selectedCoachId) || null;
    const strat = x => x ? { name: x.name, level: x.level, xp: x.experience, trainable: trainable(x), maxed: Boolean(x.maxed) } : null;
    return {
      coaches: (s.coaches || []).map(c => ({ id: c.id, name: c.name, description: c.description || '', offense: { ...strat(c.offense), id: c.offense?.id }, defense: { ...strat(c.defense), id: c.defense?.id } })),
      config: s.config ? { minXp: s.config.minXp, maxXp: s.config.maxXp, xpPerStrat: s.config.xpPerStrat } : null,
      selectedCoachId: s.selectedCoachId || null, coachName: coach?.name || null,
      offense: strat(coach?.offense), defense: strat(coach?.defense),
      cards: { master: Number(s.cards?.master) || 0, change: Number(s.cards?.change) || 0 },
      today: { used: Number(s.today?.used) || 0, free: Number(s.today?.free) || 0, max: Number(s.today?.max) || 0, nextTicketCost: Number(s.today?.nextTicketCost) || 0 },
      training: s.training ? { startedAt: s.training.startedAt, endsAt: s.training.endsAt } : null
    };
  }

  async _strategies(c, signal) {
    const r = await c.gs.call('getUserStrategies', { userId: c.userId }, 'userStrategies', { signal, timeoutMs: TIMEOUT_MS }).catch(() => null);
    const one = s => ({ id: s.id, name: s.name, description: s.description || '', learned: Boolean(s.learned), level: s.level, xp: Number(s.experience) || 0, active: Boolean(s.isActive), boost: Number(s.matchBoost) || 0, penalty: Number(s.mismatchPenalty) || 0, beats: s.beats || [], losesTo: s.losesTo || [], learnCost: Number(s.learnCost) || 0 });
    return r ? { offense: (r.offense || []).map(one), defense: (r.defense || []).map(one) } : null;
  }

  async _superView(c, signal) {
    const p = await this._ack(c, 'superBig3:getUserProgress', { userId: c.userId }, signal).catch(() => null);
    const a = await this._ack(c, 'superBig3:getTrainingAttempts', { userId: c.userId }, signal).catch(() => null);
    const pr = p?.success ? p.progress : null;
    return {
      exists: Boolean(pr?.id), id: pr?.id || null,
      progress: pr ? { level: Number(pr.level) || 0, xp: Number(pr.xp) || 0, availablePoints: Number(pr.availablePoints) || 0, offenseBonus: Number(pr.offenseBonus) || 0, defenseBonus: Number(pr.defenseBonus) || 0, trainingStart: pr.trainingStart || null, trainingEnd: pr.trainingEnd || null } : null,
      players: (p?.playerInfo || []).map(x => ({ id: x.id, name: x.visualName || x.name, rating: x.rating, position: x.position })),
      attempts: a?.success ? { left: Number(a.attemptsRemaining) || 0, max: Number(a.maxAttempts) || 3 } : null
    };
  }

  async _big3View(c, teamId, signal) {
    const teams = (await this._ack(c, 'big3:getTeams', { userId: c.userId }, signal))?.teams || [];
    const attempts = await this._ack(c, 'big3:getTrainingAttempts', { userId: c.userId }, signal);
    const active = await this._ack(c, 'big3:getUserActiveBig3Type', { userId: c.userId }, signal);
    const auto = this._auto().big3[c.accountId];
    const pick = teamId || auto || teams.find(t => Number(t.level) > 0)?.id || teams.find(t => t.ownsTrio)?.id || null;
    let progress = null;
    if (pick) {
      const p = await this._ack(c, 'big3:getUserProgress', { userId: c.userId, big3TeamId: pick }, signal);
      if (p?.success) progress = { ...(p.progress || {}), levelCap: Number(p.levelCap) || 15, magic: p.magic || null };
    }
    return {
      teams: teams.map(t => ({ id: t.id, team: t.team, level: Number(t.level) || 0, ownsTrio: Boolean(t.ownsTrio), bonusOffense: t.bonusOffense, bonusDefense: t.bonusDefense })),
      teamId: pick, progress,
      attempts: attempts?.success ? { left: Number(attempts.attemptsRemaining) || 0, max: Number(attempts.maxAttempts) || 3 } : null,
      activeType: active?.success ? (active.activeBig3Type || null) : null
    };
  }

  // Coach and Big Three of the accounts (signs nobody out unless the game asks for a register).
  async status(accountIds, { teamIds = {} } = {}) {
    const ids = (accountIds && accountIds.length ? accountIds : this._accounts().map(a => a.id)).filter(id => this._account(id));
    for (const id of ids) await this._read(id, teamIds[id]).catch(() => null);
    this.onChanged();
    return this.snapshot();
  }
  async _read(id, teamId, signal) {
    const account = this._account(id);
    const c = { ...(await this._open(account, signal)), accountId: id };
    try {
      const coach = this._coachView(await this._coachState(c, signal));
      const big3 = await this._big3View(c, teamId, signal);
      const strategies = await this._strategies(c, signal);
      const superBig3 = await this._superView(c, signal);
      this.info[id] = { coach, big3, strategies, superBig3, readAt: new Date(this.now()).toISOString(), error: null };
      return this.info[id];
    } catch (error) {
      this.info[id] = { ...(this.info[id] || {}), error: error.message, readAt: new Date(this.now()).toISOString() };
      throw error;
    } finally { this._close(c); }
  }

  // ---------- Coach ----------
  async selectCoach(id, coachId) {
    return this._with(id, async (c, signal) => {
      const before = this.info[id]?.coach;
      const r = await this._ack(c, 'selectCoach', { userId: c.userId, coachId }, signal);
      if (!r?.success) throw new Error(r?.error || r?.message || 'The coach could not be chosen.');
      const name = before?.coaches?.find(x => x.id === coachId)?.name || '?';
      this._log(id, 'success', 'coachSelected', { coach: name }, `Coach chosen · ${name}`);
    });
  }

  // One coach step: claim a finished training, then start one when it is free (never tickets).
  async coachTick(id, { signal = null, manual = false } = {}) {
    return this._with(id, async c => {
      let s = this._coachView(await this._coachState(c, signal));
      if (s.training && Date.parse(s.training.endsAt) <= this.now()) {
        const r = await this._ack(c, 'claimCoachTraining', { userId: c.userId }, signal);
        if (r?.success === false) throw new Error(r.error || r.message || 'The training could not be claimed.');
        this._log(id, 'success', 'coachClaimed', { coach: s.coachName || '?' }, `Coach training claimed · ${s.coachName || '?'}`);
        s = this._coachView(await this._coachState(c, signal));
      }
      if (s.training) return 'training';
      if (!s.selectedCoachId) { if (manual) this._log(id, 'warning', 'noCoach', {}, 'No coach chosen yet'); return 'noCoach'; }
      if (!(s.offense?.trainable || s.defense?.trainable)) { if (manual) this._log(id, 'info', 'coachNothing', { coach: s.coachName }, `${s.coachName}: no strategy to train (SUPERFINE needed, MASTER is the top)`); return 'nothing'; }
      if (s.cards.master < 1) { if (manual) this._log(id, 'info', 'noCard', {}, 'No Strategy Master Card left'); return 'noCard'; }
      if (s.today.used >= s.today.free || s.today.nextTicketCost > 0) return 'noFree'; // the rest costs tickets
      const r = await this._ack(c, 'startCoachTraining', { userId: c.userId }, signal);
      if (r?.success === false) throw new Error(r.error || r.message || 'The training could not start.');
      this._log(id, 'success', 'coachStarted', { coach: s.coachName }, `Coach training started · ${s.coachName} · 3 h`);
      return 'started';
    }, { signal });
  }

  // ---------- Big Three ----------
  async upgradeBonus(id, teamId, bonusType) {
    if (!['offense', 'defense'].includes(bonusType)) throw new Error('Unknown bonus.');
    return this._with(id, async (c, signal) => {
      const r = await this._ack(c, 'big3:upgradeBonus', { userId: c.userId, big3TeamId: teamId, bonusType }, signal);
      if (!r?.success) throw new Error(r?.error || r?.message || 'The bonus could not be raised.');
      this._log(id, 'success', 'bonusUp', { type: bonusType }, `Big3 bonus point → ${bonusType}`);
    }, { teamId });
  }
  async setActive(id, on) {
    return this._with(id, async (c, signal) => {
      const r = await this._ack(c, on ? 'big3:activate' : 'big3:deactivate', { userId: c.userId }, signal);
      if (!r?.success) throw new Error(r?.error || r?.message || 'Big3 could not be changed.');
      this._log(id, 'success', on ? 'activated' : 'deactivated', {}, on ? 'Big3 activated' : 'Big3 deactivated');
    });
  }

  // ---------- My Super Lineup (Super Big 3) ----------
  async superPlayers(id) {
    const account = this._account(id);
    const c = { ...(await this._open(account)), accountId: id };
    try {
      const r = await this._ack(c, 'superBig3:getUserPlayers', { userId: c.userId });
      if (!r?.success) throw new Error(r?.error || 'The roster could not be read.');
      return (r.players || []).map(x => ({ id: x.id, name: x.visualName || x.name, rating: x.rating, position: x.position, offense: x.offense, defense: x.defense }));
    } finally { this._close(c); }
  }
  // Creates the trio, or changes it (that resets all its progress: the page asks first).
  async superSetPlayers(id, playerIds) {
    if (!Array.isArray(playerIds) || playerIds.length !== 3) throw new Error('Choose exactly 3 players.');
    return this._with(id, async (c, signal) => {
      const cur = await this._superView(c, signal);
      const r = await this._ack(c, 'superBig3:updatePlayers', { userId: c.userId, superBig3Id: cur.id, playerIds }, signal);
      if (!r?.success) throw new Error(r?.error || r?.message || 'The Super Big 3 could not be saved.');
      this._log(id, 'success', 'superSaved', {}, cur.id ? 'Super Big 3 lineup changed (progress reset)' : 'Super Big 3 created');
    });
  }
  async superBonus(id, bonusType) {
    if (!['offense', 'defense'].includes(bonusType)) throw new Error('Unknown bonus.');
    return this._with(id, async (c, signal) => {
      const cur = await this._superView(c, signal);
      if (!cur.id) throw new Error('Create the Super Big 3 first.');
      const r = await this._ack(c, 'superBig3:upgradeBonus', { userId: c.userId, superBig3Id: cur.id, bonusType }, signal);
      if (!r?.success) throw new Error(r?.error || r?.message || 'The bonus could not be raised.');
      this._log(id, 'success', 'bonusUp', { type: bonusType }, `Super Big3 bonus point → ${bonusType}`);
    });
  }
  async superActive(id, on) {
    return this._with(id, async (c, signal) => {
      const cur = await this._superView(c, signal);
      if (on && !cur.id) throw new Error('Create the Super Big 3 first.');
      const r = await this._ack(c, on ? 'superBig3:activate' : 'superBig3:deactivate', on ? { userId: c.userId, superBig3Id: cur.id } : { userId: c.userId }, signal);
      if (!r?.success) throw new Error(r?.error || r?.message || 'Super Big 3 could not be changed.');
      this._log(id, 'success', on ? 'superActivated' : 'deactivated', {}, on ? 'Super Big 3 activated' : 'Super Big 3 deactivated');
    });
  }
  // One Super Big 3 step: finish an ended training, start a normal one (never intensive / early).
  async superTick(id, { signal = null, manual = false } = {}) {
    return this._with(id, async c => {
      let cur = await this._superView(c, signal);
      if (!cur.id) return 'noTeam';
      const end = cur.progress?.trainingEnd;
      if (end && Date.parse(end) <= this.now()) {
        const r = await this._ack(c, 'superBig3:finishTraining', { userId: c.userId, superBig3Id: cur.id }, signal);
        if (!r?.success) throw new Error(r?.error || r?.message || 'The training could not be finished.');
        this._log(id, 'success', 'superFinished', {}, 'Super Big 3 training finished');
        cur = await this._superView(c, signal);
      }
      if (cur.progress?.trainingEnd && Date.parse(cur.progress.trainingEnd) > this.now()) return 'training';
      const active = await this._ack(c, 'big3:getActiveTraining', { userId: c.userId }, signal).catch(() => null);
      if (active?.hasActiveTraining) return 'otherTraining';
      if (!(cur.attempts?.left > 0)) return 'noAttempts';
      const r = await this._ack(c, 'superBig3:startTraining', { userId: c.userId, superBig3Id: cur.id, useIntensive: false }, signal);
      if (!r?.success) { if (r?.requiresIntensive) return 'noAttempts'; throw new Error(r?.error || r?.message || 'The training could not start.'); }
      this._log(id, 'success', 'superStarted', {}, 'Super Big 3 training started · 3 h');
      return 'started';
    }, { signal });
  }

  // One Big3 step for a trio: finish a training whose time is over, start a normal one when an
  // attempt is left (intensive / early finish cost tickets: never).
  async big3Tick(id, teamId, { signal = null, manual = false } = {}) {
    if (!teamId) return 'noTeam';
    return this._with(id, async c => {
      const read = async () => {
        const p = await this._ack(c, 'big3:getUserProgress', { userId: c.userId, big3TeamId: teamId }, signal);
        if (!p?.success) throw new Error(p?.error || 'Big3 progress could not be read.');
        return { ...(p.progress || {}), levelCap: Number(p.levelCap) || 15, magic: p.magic || {} };
      };
      let p = await read();
      // past level 15 (after the Magic Team prize) the trio trains with magic:*
      const magic = Number(p.level) >= 15 && Boolean(p.magic?.claimedAt);
      const prefix = magic ? 'magic' : 'big3';
      const name = this.info[id]?.big3?.teams?.find(t => t.id === teamId)?.team || '?';
      if (p.trainingEnd && Date.parse(p.trainingEnd) <= this.now()) {
        const r = await this._ack(c, `${prefix}:finishTraining`, { userId: c.userId, big3TeamId: teamId }, signal);
        if (!r?.success) throw new Error(r?.error || r?.message || 'The training could not be finished.');
        this._log(id, 'success', 'big3Finished', { team: name }, `Big3 training finished · ${name}`);
        p = await read();
      }
      if (p.trainingEnd && Date.parse(p.trainingEnd) > this.now()) return 'training';
      const cap = magic ? 20 : (Number(p.levelCap) || 15);
      if (Number(p.level) >= cap) { if (manual) this._log(id, 'info', 'big3Max', { team: name, level: p.level }, `${name}: level ${p.level} · nothing to train here`); return 'max'; }
      const active = await this._ack(c, 'big3:getActiveTraining', { userId: c.userId }, signal);
      if (active?.hasActiveTraining) return 'otherTraining';
      const a = await this._ack(c, 'big3:getTrainingAttempts', { userId: c.userId }, signal);
      if (!a?.success || !(Number(a.attemptsRemaining) > 0)) return 'noAttempts';
      const r = await this._ack(c, `${prefix}:startTraining`, { userId: c.userId, big3TeamId: teamId, useIntensive: false }, signal);
      if (!r?.success) {
        if (r?.requiresIntensive) return 'noAttempts';
        throw new Error(r?.error || r?.message || 'The training could not start.');
      }
      this._log(id, 'success', 'big3Started', { team: name }, `Big3 training started · ${name} · 3 h`);
      return 'started';
    }, { signal, teamId });
  }

  async _with(id, fn, { signal = null, teamId = undefined } = {}) {
    const account = this._account(id);
    if (!account) throw new Error('Account not found.');
    if (this.busy.has(id)) throw new Error('This account is busy, try again in a moment.');
    this.busy.add(id);
    this.onChanged();
    const c = { ...(await this._open(account, signal).catch(e => { this.busy.delete(id); this.onChanged(); throw e; })), accountId: id };
    try {
      const out = await fn(c, signal);
      try {
        const coach = this._coachView(await this._coachState(c, signal));
        const big3 = await this._big3View(c, teamId ?? this.info[id]?.big3?.teamId, signal);
        const strategies = await this._strategies(c, signal);
        const superBig3 = await this._superView(c, signal);
        this.info[id] = { coach, big3, strategies, superBig3, readAt: new Date(this.now()).toISOString(), error: null };
      } catch {}
      return out;
    } finally {
      this._close(c);
      this.busy.delete(id);
      this.onChanged();
    }
  }

  // Every 10 minutes: the accounts ticked for Coach / Big3 automation.
  async autoRun() {
    if (this.gameHealth?.isDown?.()) return;
    const { coach, big3, superBig3 } = this._auto();
    for (const id of coach) if (this._account(id)) await this.coachTick(id).catch(e => this._log(id, 'warning', 'autoFailed', { error: e.message }, `Coach: ${e.message}`));
    for (const [id, teamId] of Object.entries(big3)) if (this._account(id) && teamId) await this.big3Tick(id, teamId).catch(e => this._log(id, 'warning', 'autoFailed', { error: e.message }, `Big3: ${e.message}`));
    for (const id of superBig3) if (this._account(id)) await this.superTick(id).catch(e => this._log(id, 'warning', 'autoFailed', { error: e.message }, `Super Big3: ${e.message}`));
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.autoRun().catch(() => {}), this.autoMs);
    this.timer.unref?.();
    setTimeout(() => this.autoRun().catch(() => {}), 90 * 1000).unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

// Magic Team (Proving Grounds → Big 3): a level 15 trio, active in Big3, beats two bots
// (MIAMI, then PHILADELPHIA) and claims a prize. magic:getData {userId, big3TeamId} ->
// {progress, magic{status LOCKED|FIGHTING|REWARD|…, botsDefeated}, rounds[{round, enemy}], isBig3Active};
// /simulation-socket/ playMagicTeamMatch {userId, big3TeamId} (ack) -> {success, matchId}; pays like a PK
// match (same daily PK limit), retries unlimited; magic:claimReward {userId, big3TeamId}.
const SIM_PATH = '/simulation-socket/';
const MAX_TRIES = 6; // matches per run and account (retries are free but every match costs PK limit)

class MagicTeamService extends ProvingBase {
  constructor(deps) { super(deps, { taskName: 'Magic Team', prefix: 'mt', reportKey: 'magicTeamReport' }); this.finalStatuses = ['claimed', 'locked', 'inactive', 'pkLimit']; }

  async _main(account, signal) {
    const session = await this.sessions.get(account, { owner: 'magic-team' });
    const borrowed = GameSocket.borrow?.(session.userId);
    const gs = borrowed || await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader, signal });
    return { gs, own: !borrowed, session };
  }
  async _ack(c, event, payload, signal) {
    let r = await c.gs.ack(event, payload, { signal, timeoutMs: 15000 });
    if (!r?.success && AUTH.test(String(r?.error || r?.message || '')) && c.own && !c.registered) {
      await c.gs.register(c.session.userId, { signal, owner: 'Magic Team' });
      c.registered = true;
      r = await c.gs.ack(event, payload, { signal, timeoutMs: 15000 });
    }
    return r;
  }
  async _teams(c, signal) {
    const t = await this._ack(c, 'big3:getTeams', { userId: c.session.userId }, signal);
    const o = await this._ack(c, 'magic:getOverview', { userId: c.session.userId }, signal);
    const byId = Object.fromEntries((o?.teams || []).map(x => [x.big3TeamId, x]));
    return (t?.teams || []).map(x => ({ id: x.id, team: x.team, level: Number(byId[x.id]?.level ?? x.level) || 0, status: byId[x.id]?.status || 'LOCKED', botsDefeated: Number(byId[x.id]?.botsDefeated) || 0, ownsTrio: Boolean(x.ownsTrio) }));
  }
  async _data(c, teamId, signal) {
    const d = await this._ack(c, 'magic:getData', { userId: c.session.userId, big3TeamId: teamId }, signal);
    if (!d?.success) throw new Error(d?.error || 'Magic Team could not be read.');
    const status = d.magic?.status || 'LOCKED';
    const beaten = Number(d.magic?.botsDefeated) || 0;
    const next = (d.rounds || []).find(r => Number(r.round) === beaten + 1);
    return { status, beaten, rounds: (d.rounds || []).length || 2, enemy: next?.enemy?.teamName || null, level: Number(d.progress?.level) || 0, active: Boolean(d.isBig3Active) };
  }

  // Trios of every account (level, Magic status) with a short sign-in.
  async status(accountIds) {
    const ids = accountIds || this.store.getAccounts().map(a => a.id);
    for (const id of ids) {
      const account = this.store.getAccounts().find(a => a.id === id);
      if (!account) continue;
      let c = null;
      try { c = await this._main(account); const teams = await this._teams(c); this.info[id] = { teams: teams.filter(t => t.level > 0 || t.status !== 'LOCKED'), readAt: new Date(this.now()).toISOString() }; }
      catch (e) { this.info[id] = { ...(this.info[id] || {}), error: e.message }; }
      finally { if (c?.own) { try { c.gs.close(); } catch {} } }
    }
    this.onChanged();
    return this.snapshot();
  }

  async _account(id, signal) {
    const account = this.store.getAccounts().find(a => a.id === id);
    this._row(id, { status: 'login' });
    const c = await this._main(account, signal);
    const userId = c.session.userId;
    let sim = null;
    try {
      let teamId = this.run.accounts[id].target;
      if (!teamId || teamId === true || teamId === 'auto') {
        const teams = await this._teams(c, signal);
        teamId = (teams.find(t => t.status === 'REWARD') || teams.find(t => t.status === 'FIGHTING') || teams.find(t => t.level >= 15))?.id || null;
      }
      if (!teamId) { this._row(id, { status: 'locked', reason: 'Lv 15 trio' }); this._log(id, 'warning', 'locked', {}, 'Magic Team needs a level 15 Big3 trio'); return; }
      let d = await this._data(c, teamId, signal);
      this._row(id, { teamId, beaten: d.beaten, enemy: d.enemy, level: d.level });
      if (d.status === 'FIGHTING' && !d.active) { this._row(id, { status: 'inactive', reason: 'Big3' }); this._log(id, 'warning', 'inactive', {}, 'Activate this trio in Office → Big Three first'); return; }
      if (d.status === 'LOCKED') { this._row(id, { status: 'locked', reason: `Lv ${d.level}/15` }); return; }
      let tries = 0;
      while (d.status === 'FIGHTING' && tries < MAX_TRIES) {
        await this._waitOtherMatch(id, userId, signal);
        if (!sim) sim = await GameSocket.open({ createSocket: this.createSocket, path: SIM_PATH, cookie: c.session.cookieHeader, signal });
        this._row(id, { status: 'starting', enemy: d.enemy });
        await matchStartSlot(signal, this.timing.startGapMs);
        const r = await sim.ack('playMagicTeamMatch', { userId, big3TeamId: teamId }, { signal, timeoutMs: 20000 });
        if (!r?.success) {
          const msg = String(r?.error || r?.message || 'refused');
          if (r?.code === 'PK_DAILY_LIMIT' || /PK limit/i.test(msg)) { this._row(id, { status: 'pkLimit' }); this._log(id, 'warning', 'pkLimit', {}, 'Daily PK limit reached · Magic Team waits for the reset'); return; }
          throw new Error(msg);
        }
        tries++;
        const n = this.run.accounts[id].played + 1;
        const enemy = d.enemy || '?';
        this._log(id, 'info', 'matchStarted', { n, enemy }, `Magic Team match ${n} started · vs ${enemy}`);
        await this._waitMatchEnd(id, userId, signal);
        const before = d.beaten;
        d = await this._data(c, teamId, signal);
        const won = d.beaten > before || d.status === 'REWARD';
        const row = this.run.accounts[id];
        this._row(id, { played: n, won: row.won + (won ? 1 : 0), lost: row.lost + (won ? 0 : 1), beaten: d.beaten, enemy: d.enemy, last: won ? 'won' : 'lost' });
        this._log(id, won ? 'success' : 'warning', won ? 'matchWon' : 'matchLost', { n, enemy, result: won ? 'won' : 'lost' }, `Magic Team match ${n} · vs ${enemy} · ${won ? 'won' : 'lost'}`);
      }
      if (d.status === 'REWARD') {
        const r = await this._ack(c, 'magic:claimReward', { userId, big3TeamId: teamId }, signal);
        if (!r?.success) throw new Error(r?.error || 'The prize could not be claimed.');
        const items = (Array.isArray(r.reward) ? r.reward : []).map(x => `${x.quantity || 1} ${x.name || x.kind || ''}`.trim()).join(', ');
        this._log(id, 'success', 'claimed', { items: items || '—' }, `Magic Team prize claimed${items ? ` · ${items}` : ''} · the trio can now train to level 20`);
        this._row(id, { status: 'claimed' });
        return;
      }
      this._row(id, { status: this.run.accounts[id].played ? 'done' : 'noAttempts' });
    } finally {
      try { sim?.close(); } catch {}
      if (c.own) { try { c.gs.close(); } catch {} }
    }
  }
}

module.exports = { OfficeService, MagicTeamService, LEVELS, trainable };
