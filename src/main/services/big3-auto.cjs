const { GameSocket } = require('./game-socket.cjs');
const { WIDE, eachAtOnce, eachWithSocket } = require('./wide.cjs');
const { nextReset } = require('./cheer-service.cjs');

// Office → Big 3, set up and trained by itself (user 2026-11-09).
//
// Set-up ("Takımları tara" → "Aktifleştir", run rarely): an account that owns a league trio
// (big3:getTeams ownsTrio — the Magic Team trio) gets that Big 3 activated; otherwise its Super
// Big 3 ("My Super Lineup") is used AS IT IS — an existing one is never rebuilt, even when it is
// not the best three; an account without one gets a Super Big 3 of the 3 best starters
// (offense + defense) and it is activated.
//
// Training (always on unless switched off, like Daily Reward: no Auto Play needed, nothing else
// paused): 3 free trainings a day, 3 h each. Every account with an active Big 3 / Super Big 3 is
// looked at when its training time is over: finish it, put new bonus points (offense by default,
// the choice per account), start the next free one. Level 10 is the most training gives
// (15 comes another way): from 10 on nothing is started. No attempts left → wait for the reset
// (19:10 TR). Intensive training and early finish cost tickets: never used.
//
// Reads are anonymous (no sign-in); writes go through OfficeService's connection (another
// service's registered socket if one is live, else the cookie, `register` only when asked).
const MAX_TRAIN_LEVEL = 10;
const TICK_MS = 30 * 1000;
const PARALLEL = WIDE; // every account at once (user 2026-11-11)
const RECHECK_MS = 6 * 60 * 60 * 1000;   // no Big 3 active: look again later
const ERROR_RETRY_MS = 15 * 60 * 1000;
const AFTER_END_MS = 30 * 1000;
const RESET_AFTER_MS = 2 * 60 * 1000;
const READ_TIMEOUT_MS = 10000;
const GRADES = ['D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+', 'S-', 'S', 'S+', 'X'];

// The three best of the starters (all players when fewer than 3 starters): offense + defense,
// then rating.
function bestThree(players, starterIds) {
  const pool = players.filter(p => starterIds.has(p.id));
  const list = (pool.length >= 3 ? pool : players).slice();
  list.sort((a, b) => ((Number(b.offense) || 0) + (Number(b.defense) || 0)) - ((Number(a.offense) || 0) + (Number(a.defense) || 0)) || GRADES.indexOf(b.rating) - GRADES.indexOf(a.rating));
  return list.slice(0, 3);
}

// What set-up does for an account: 'big3' | 'superKeep' | 'superCreate' | 'rebuild' | 'none'.
// 'rebuild' (user 2026-11-13): the Super Big 3 lost players from the roster (starters changed) and
// can neither train nor give its bonus; the game's lineup change puts the 3 best starters in, which
// resets its level, XP and bonuses to 0.
function planOf({ trio, superBig3, best, broken = false }) {
  if (trio) return 'big3';
  if (superBig3 && broken) return best.length === 3 ? 'rebuild' : 'none';
  if (superBig3) return 'superKeep';
  if (best.length === 3) return 'superCreate';
  return 'none';
}

class Big3Auto {
  constructor({ store, activity, office, onChanged, createSocket, gameHealth = null, isPaused = () => false, now = () => Date.now(), timing = {} }) {
    Object.assign(this, { store, activity, office, createSocket, gameHealth, isPaused, now });
    this.onChanged = onChanged || (() => {});
    this.timing = { tickMs: TICK_MS, ...timing };
    this.accounts = {};   // accountId -> { type, target, teamName, level, xp, points, attemptsLeft, trainingEnd, nextAt, status, message }
    this.scan = { busy: false, at: null, rows: {} };
    this.setupBusy = false;
    this.working = new Set();
    this.timer = null;
  }

  _settings() { return this.store.getSettings?.() || {}; }
  enabled() { return this._settings().big3Train !== false; }
  bonusOf(id) { const b = this._settings().big3Bonus || {}; return b[id] === 'defense' ? 'defense' : 'offense'; }
  _accountsList() { return (this.store.getAccounts?.() || []).filter(a => !a.signupPending); }
  _account(id) { return this._accountsList().find(a => a.id === id) || null; }
  _userId(id) { return this.store.getAccountProfile?.()?.accounts?.[id]?.userId || null; }
  _log(id, level, code, params, message) {
    this.activity.add({ level, accountId: id || null, accountName: id ? (this._account(id)?.name || '') : '', taskName: 'Big 3', code: `b3.${code}`, params, message });
  }
  _set(id, patch) { this.accounts[id] = { ...(this.accounts[id] || {}), ...patch }; this.onChanged(); }

  snapshot() {
    const bonus = {};
    for (const a of this._accountsList()) bonus[a.id] = this.bonusOf(a.id);
    return { enabled: this.enabled(), accounts: JSON.parse(JSON.stringify(this.accounts)), scan: JSON.parse(JSON.stringify(this.scan)), setupBusy: this.setupBusy, working: [...this.working], bonus, maxLevel: MAX_TRAIN_LEVEL };
  }

  async setEnabled(on) {
    this.store.saveSettings?.({ ...this._settings(), big3Train: Boolean(on) });
    if (on) for (const id of Object.keys(this.accounts)) this.accounts[id].nextAt = null;
    this.onChanged();
    if (on) this.tick().catch(() => {});
    return this.snapshot();
  }

  // ---------- anonymous reads ----------
  async _anon() { return GameSocket.open({ createSocket: this.createSocket }); }
  async _ackAnon(gs, event, payload) { return gs.ack(event, payload, { timeoutMs: READ_TIMEOUT_MS }); }

  // The trio Big 3 trains for this account: an owned league trio (highest level first).
  async _view(gs, userId) {
    const type = (await this._ackAnon(gs, 'big3:getUserActiveBig3Type', { userId }))?.activeBig3Type || null;
    const teams = (await this._ackAnon(gs, 'big3:getTeams', { userId }))?.teams || [];
    const trio = teams.filter(t => t.ownsTrio).sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0))[0] || null;
    const sp = await this._ackAnon(gs, 'superBig3:getUserProgress', { userId });
    const superBig3 = sp?.success && sp.progress?.id ? { ...sp.progress, players: (sp.playerInfo || []).map(p => p.visualName || p.name), names: Object.fromEntries((sp.playerInfo || []).map(p => [p.id, p.visualName || p.name])) } : null;
    return { type, trio, superBig3 };
  }

  // ---------- set-up: scan, then activate ----------
  async scanAccounts(accountIds) {
    if (this.scan.busy) return this.snapshot();
    const ids = (accountIds && accountIds.length ? accountIds : this._accountsList().map(a => a.id)).filter(id => this._account(id) && this._userId(id));
    this.scan = { busy: true, at: null, rows: {}, done: 0, total: ids.length };
    this.onChanged();
    // every account at once, a socket per lane
    try {
      await eachWithSocket(ids, () => this._anon(), async (gs, id) => {
        const userId = this._userId(id);
        try {
          const v = await this._view(gs, userId);
          const players = (await this._ackAnon(gs, 'superBig3:getUserPlayers', { userId }))?.players || [];
          const roster = await this._ackAnon(gs, 'getTeamOptimized', { userId });
          const starters = new Set((roster?.players?.starters || []).map(p => p.id));
          const inRoster = new Set([...(roster?.players?.starters || []), ...(roster?.players?.bench || [])].map(p => p.id));
          const missing = v.superBig3 ? (v.superBig3.playerIds || []).filter(pid => !inRoster.has(pid)).map(pid => v.superBig3.names?.[pid] || '?') : [];
          // the league Big 3 is active but its trio is not owned any more
          const lostTrio = v.type === 'BIG3' && !v.trio;
          const best = bestThree(players, starters);
          const plan = planOf({ trio: v.trio, superBig3: v.superBig3, best, broken: missing.length > 0 });
          const done = (plan === 'big3' && v.type === 'BIG3') || (plan === 'superKeep' && v.type === 'SUPERBIG3');
          this.scan.rows[id] = {
            name: this._account(id).name, type: v.type, plan, done,
            trio: v.trio ? { id: v.trio.id, team: v.trio.team, level: Number(v.trio.level) || 0 } : null,
            superBig3: v.superBig3 ? { id: v.superBig3.id, level: Number(v.superBig3.level) || 0, players: v.superBig3.players, missing } : null,
            broken: missing.length > 0 || lostTrio, lostTrio,
            best: best.map(p => ({ id: p.id, name: p.visualName || p.name, rating: p.rating, offense: p.offense, defense: p.defense }))
          };
        } catch (error) {
          this.scan.rows[id] = { name: this._account(id).name, plan: 'error', error: error.message };
          this.scan.done += 1;
          this.onChanged();
          throw error; // the lane opens a fresh socket
        }
        this.scan.done += 1;
        this.onChanged();
      });
    } finally {
      this.scan.busy = false;
      this.scan.at = new Date(this.now()).toISOString();
      this.onChanged();
    }
    const rows = Object.values(this.scan.rows);
    this._log(null, 'info', 'scanned', { total: rows.length, big3: rows.filter(r => r.plan === 'big3').length, keep: rows.filter(r => r.plan === 'superKeep').length, create: rows.filter(r => r.plan === 'superCreate').length }, `Big 3 scan · ${rows.length} account(s)`);
    return this.snapshot();
  }

  async _write(id, fn) {
    const account = this._account(id);
    const c = { ...(await this.office._open(account)), accountId: id };
    try { return await fn(c); } finally { this.office._close(c); }
  }
  async _ack(c, event, payload) { return this.office._ack(c, event, payload, null); }

  // Carries out the scanned plan for the chosen accounts (only those not done yet).
  async setup(accountIds) {
    if (this.setupBusy) throw new Error('Big 3 set-up is already running.');
    const ids = (accountIds || []).filter(id => this.scan.rows[id] && !this.scan.rows[id].done && ['big3', 'superKeep', 'superCreate', 'rebuild'].includes(this.scan.rows[id].plan));
    if (!ids.length) throw new Error('Nothing to activate: scan first, or every account is already set.');
    this.setupBusy = true;
    this.onChanged();
    let ok = 0;
    try {
      for (const id of ids) {
        const row = this.scan.rows[id];
        row.status = 'working';
        this.onChanged();
        try {
          await this._write(id, async c => {
            const userId = c.userId;
            // only one kind can be active: switch the other off first when it answers so
            const activate = async (event, payload, otherOff) => {
              let r = await this._ack(c, event, payload);
              if (!r?.success && /active|already|another|super|big ?3/i.test(String(r?.error || r?.message || ''))) {
                await this._ack(c, otherOff, { userId }).catch(() => null);
                r = await this._ack(c, event, payload);
              }
              if (!r?.success) throw new Error(r?.error || r?.message || 'could not be activated');
            };
            if (row.plan === 'big3') {
              await activate('big3:activate', { userId }, 'superBig3:deactivate');
              this._log(id, 'success', 'big3On', { team: row.trio.team }, `Big 3 activated · ${row.trio.team}`);
            } else if (row.plan === 'rebuild') {
              // the lineup change: level, XP, bonuses and a running training go back to 0
              const r = await this._ack(c, 'superBig3:updatePlayers', { userId, superBig3Id: row.superBig3.id, playerIds: row.best.map(p => p.id) });
              if (!r?.success) throw new Error(r?.error || r?.message || 'the Super Big 3 could not be rebuilt');
              if (row.type !== 'SUPERBIG3') await activate('superBig3:activate', { userId, superBig3Id: row.superBig3.id }, 'big3:deactivate');
              const old = row.superBig3.players.join(', ');
              row.superBig3 = { id: row.superBig3.id, level: 0, players: row.best.map(p => p.name), missing: [] };
              row.broken = false;
              this._log(id, 'success', 'rebuilt', { from: old, players: row.best.map(p => p.name).join(', ') }, `Super Big 3 rebuilt · ${old} → ${row.best.map(p => p.name).join(', ')} (level 0)`);
            } else if (row.plan === 'superKeep') {
              await activate('superBig3:activate', { userId, superBig3Id: row.superBig3.id }, 'big3:deactivate');
              this._log(id, 'success', 'superOn', { players: row.superBig3.players.join(', ') }, `Super Big 3 activated · ${row.superBig3.players.join(', ')}`);
            } else {
              const r = await this._ack(c, 'superBig3:updatePlayers', { userId, superBig3Id: undefined, playerIds: row.best.map(p => p.id) });
              if (!r?.success) throw new Error(r?.error || r?.message || 'the Super Big 3 could not be created');
              const gs = await this._anon();
              let sbId = null;
              try { sbId = (await this._ackAnon(gs, 'superBig3:getUserProgress', { userId }))?.progress?.id || null; } finally { try { gs.close(); } catch {} }
              if (!sbId) throw new Error('the new Super Big 3 was not found');
              await activate('superBig3:activate', { userId, superBig3Id: sbId }, 'big3:deactivate');
              row.superBig3 = { id: sbId, level: 0, players: row.best.map(p => p.name) };
              this._log(id, 'success', 'superCreated', { players: row.best.map(p => p.name).join(', ') }, `Super Big 3 created and activated · ${row.best.map(p => p.name).join(', ')}`);
            }
          });
          row.status = 'done';
          row.done = true;
          ok += 1;
          this._set(id, { nextAt: null }); // the trainer looks at it right away
        } catch (error) {
          row.status = 'error';
          row.error = error.message;
          this._log(id, 'error', 'setupFailed', { error: error.message }, `Big 3 set-up failed: ${error.message}`);
        }
        this.onChanged();
      }
    } finally {
      this.setupBusy = false;
      this.onChanged();
    }
    this._log(null, ok === ids.length ? 'success' : 'warning', 'setupDone', { ok, total: ids.length }, `Big 3 set-up · ${ok}/${ids.length} account(s)`);
    this.tick().catch(() => {});
    return this.snapshot();
  }

  // ---------- bonus choice ----------
  // The choice is saved; the points already given are moved (reset is free) when they differ.
  async setBonus(id, type) {
    if (!['offense', 'defense'].includes(type)) throw new Error('Unknown bonus.');
    const s = this._settings();
    this.store.saveSettings?.({ ...s, big3Bonus: { ...(s.big3Bonus || {}), [id]: type } });
    this.onChanged();
    const userId = this._userId(id);
    if (!userId) return this.snapshot();
    const gs = await this._anon();
    let target = null;
    try { target = await this._target(gs, userId); } finally { try { gs.close(); } catch {} }
    if (!target) return this.snapshot();
    const other = type === 'offense' ? 'defense' : 'offense';
    const p = target.progress;
    if ((Number(p[`${other}Bonus`]) || 0) > 0) {
      await this._write(id, async c => {
        const r = await this._ack(c, `${target.prefix}:resetBonuses`, { userId, ...target.key });
        if (!r?.success) throw new Error(r?.error || r?.message || 'the bonuses could not be reset');
        const points = Number(r.progress?.availablePoints) || 0;
        for (let i = 0; i < points; i++) await this._ack(c, `${target.prefix}:upgradeBonus`, { userId, ...target.key, bonusType: type });
        this._log(id, 'success', 'bonusMoved', { type, points }, `Big 3 bonus moved · ${points} point(s) → ${type}`);
      });
    }
    this._set(id, { nextAt: null });
    return this.snapshot();
  }

  // ---------- training ----------
  // The active trio of the account: { prefix, key, name, progress, attempts } or null.
  async _target(gs, userId) {
    const v = await this._view(gs, userId);
    if (v.type === 'SUPERBIG3' && v.superBig3) {
      const a = await this._ackAnon(gs, 'superBig3:getTrainingAttempts', { userId });
      return { kind: 'SUPERBIG3', prefix: 'superBig3', key: { superBig3Id: v.superBig3.id }, name: v.superBig3.players.join(', '), progress: v.superBig3, attempts: a };
    }
    if (v.type === 'BIG3' && v.trio) {
      const p = await this._ackAnon(gs, 'big3:getUserProgress', { userId, big3TeamId: v.trio.id });
      const a = await this._ackAnon(gs, 'big3:getTrainingAttempts', { userId });
      return { kind: 'BIG3', prefix: 'big3', key: { big3TeamId: v.trio.id }, name: v.trio.team, progress: p?.progress || {}, attempts: a };
    }
    return null;
  }

  async _one(id, gs) {
    const userId = this._userId(id);
    const t = await this._target(gs, userId);
    if (!t) { this._set(id, { type: null, status: 'inactive', nextAt: this.now() + RECHECK_MS, message: null }); return; }
    const view = () => ({ type: t.kind, teamName: t.name, level: Number(t.progress.level) || 0, xp: Number(t.progress.xp) || 0, points: Number(t.progress.availablePoints) || 0, offense: Number(t.progress.offenseBonus) || 0, defense: Number(t.progress.defenseBonus) || 0, attemptsLeft: Number(t.attempts?.attemptsRemaining ?? 0), trainingEnd: t.progress.trainingEnd || null });
    const end = Date.parse(t.progress.trainingEnd || '');
    if (Number.isFinite(end) && end > this.now()) { this._set(id, { ...view(), status: 'training', nextAt: end + AFTER_END_MS, message: null }); return; }
    const needsFinish = Number.isFinite(end) && end <= this.now() && t.progress.trainingStart;
    const points = Number(t.progress.availablePoints) || 0;
    const canStart = (Number(t.progress.level) || 0) < MAX_TRAIN_LEVEL && Number(t.attempts?.attemptsRemaining) > 0;
    if (needsFinish || points > 0 || canStart) {
      await this._write(id, async c => {
        const key = { userId, ...t.key };
        if (needsFinish) {
          const r = await this._ack(c, `${t.prefix}:finishTraining`, key);
          if (r?.success) { if (r.progress) t.progress = r.progress; this._log(id, 'success', 'finished', { name: t.name, level: Number(t.progress.level) || 0 }, `Big 3 training finished · ${t.name} · level ${Number(t.progress.level) || 0}`); }
          else if (!/no (active )?training|not found|already/i.test(String(r?.error || r?.message || ''))) throw new Error(r?.error || r?.message || 'the training could not be finished');
          // the next reads show the finished state
          const fresh = await this._target(gs, userId);
          if (fresh) Object.assign(t, fresh);
        }
        const type = this.bonusOf(id);
        for (let i = 0, n = Number(t.progress.availablePoints) || 0; i < n; i++) {
          const r = await this._ack(c, `${t.prefix}:upgradeBonus`, { ...key, bonusType: type });
          if (!r?.success) break;
          if (r.progress) t.progress = r.progress;
          this._log(id, 'success', 'bonus', { type }, `Big 3 bonus point → ${type}`);
        }
        const level = Number(t.progress.level) || 0;
        if (level < MAX_TRAIN_LEVEL && Number(t.attempts?.attemptsRemaining) > 0 && !(Date.parse(t.progress.trainingEnd || '') > this.now())) {
          const r = await this._ack(c, `${t.prefix}:startTraining`, { ...key, useIntensive: false });
          if (r?.success) {
            if (r.progress) t.progress = r.progress;
            if (r.attemptsRemaining != null) t.attempts = { attemptsRemaining: r.attemptsRemaining };
            this._log(id, 'success', 'started', { name: t.name, left: Number(t.attempts?.attemptsRemaining) || 0 }, `Big 3 training started · ${t.name} · 3 h`);
          } else if (!r?.requiresIntensive) throw new Error(r?.error || r?.message || 'the training could not start');
          else t.attempts = { attemptsRemaining: 0 };
        }
      });
    }
    const v = view();
    const e2 = Date.parse(v.trainingEnd || '');
    if (Number.isFinite(e2) && e2 > this.now()) this._set(id, { ...v, status: 'training', nextAt: e2 + AFTER_END_MS, message: null });
    else if (v.level >= MAX_TRAIN_LEVEL) this._set(id, { ...v, status: 'max', nextAt: nextReset(this.now()) + RESET_AFTER_MS, message: null });
    else this._set(id, { ...v, status: 'noAttempts', nextAt: nextReset(this.now()) + RESET_AFTER_MS, message: null });
  }

  async tick() {
    if (!this.enabled() || this.isPaused() || this.gameHealth?.isDown?.()) return;
    const now = this.now();
    const due = this._accountsList().filter(a => this._userId(a.id) && !this.working.has(a.id) && !((this.accounts[a.id]?.nextAt || 0) > now)).map(a => a.id);
    if (!due.length) return;
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, due.length) }, async () => {
      let gs = null;
      try {
        for (let id; (id = due[i++]);) {
          this.working.add(id);
          try {
            gs ||= await this._anon();
            await this._one(id, gs);
          } catch (error) {
            if (/required players|missing \d+ player/i.test(error.message)) {
              const was = this.accounts[id]?.status === 'broken';
              this._set(id, { status: 'broken', message: error.message, nextAt: this.now() + RECHECK_MS });
              if (!was) this._log(id, 'warning', 'broken', { error: error.message }, `Big 3 is broken (players left the roster) · rebuild it on the Big 3 tab: ${error.message}`);
            } else {
              this._set(id, { status: 'error', message: error.message, nextAt: this.now() + ERROR_RETRY_MS });
              this._log(id, 'warning', 'failed', { error: error.message }, `Big 3 training: ${error.message}`);
            }
            try { gs?.close(); } catch {}
            gs = null;
          } finally { this.working.delete(id); }
        }
      } finally { try { gs?.close(); } catch {} }
    }));
    this.onChanged();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { if (!this._ticking) { this._ticking = true; this.tick().catch(() => {}).finally(() => { this._ticking = false; }); } }, this.timing.tickMs);
    this.timer.unref?.();
    setTimeout(() => this.tick().catch(() => {}), 60 * 1000).unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

module.exports = { Big3Auto, bestThree, planOf, MAX_TRAIN_LEVEL };
