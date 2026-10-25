// Daily Auto Play stop (and optional restart) at a Turkey time, so a forgotten Auto
// Play does not keep playing when the 15:00 tournament starts (a busy account loses
// its tournament match by forfeit).
// settings.autoPlayStop = { enabled, stopAt: 'HH:MM', resumeEnabled, resumeAt: 'HH:MM' }
// settings.autoPlayStopState = { stopDate, resumeDate, stopped: [{accountId, taskId, taskName, visibleBrowser, config}] }
// Second, independent line: daily tournament registration.
// settings.dailyTournament = { enabled (default true), at: 'HH:MM' (default 15:48) }
// settings.dailyTournamentState = { date } — at that time a one-off "Turnuva kaydı" schedule
// is handed to the scheduler, which stops the other tasks, waits for registration, runs it
// and starts them again (exactly like a schedule made by hand).
// Third line: daily PVP. settings.dailyPvp = { enabled (default true), at (default 05:01) },
// settings.dailyPvpState = { date }; same mechanism with the "PVP Arena" task.
const ACTIVE = ['running', 'preparing', 'starting'];
const CATCH_UP_MIN = 10; // a stop time is still honoured this many minutes late (app started late)

function trClock(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const toMinutes = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
// Due now: past the time today, not done today, and not more than CATCH_UP_MIN late.
function due(clock, hhmm, doneDate) {
  const at = toMinutes(hhmm);
  return at != null && doneDate !== clock.date && clock.minutes >= at && clock.minutes < at + CATCH_UP_MIN;
}

class AutoPlayStop {
  constructor({ store, engine, activity, onChanged, onAttention, scheduleTournament = null, schedulePvp = null, now = () => Date.now() }) {
    Object.assign(this, { store, engine, activity, onChanged, onAttention, scheduleTournament, schedulePvp, now });
    this.timer = null;
  }
  start() { if (!this.timer) { this.timer = setInterval(() => this.tick().catch(() => {}), 15000); this.timer.unref?.(); this.tick().catch(() => {}); } }
  stop() { clearInterval(this.timer); this.timer = null; }
  _cfg() { return { enabled: false, stopAt: '14:55', resumeEnabled: false, resumeAt: '16:00', ...(this.store.getSettings().autoPlayStop || {}) }; }
  _state() { return { stopDate: null, resumeDate: null, stopped: [], ...(this.store.getSettings().autoPlayStopState || {}) }; }
  _save(state) { this.store.saveSettings({ ...this.store.getSettings(), autoPlayStopState: state }); this.onChanged?.(); }
  _tnCfg() { return { enabled: true, at: '15:48', ...(this.store.getSettings().dailyTournament || {}) }; }
  _pvpCfg() { return { enabled: true, at: '05:01', ...(this.store.getSettings().dailyPvp || {}) }; }

  // A daily line (tournament registration, PVP): independent of the Auto Play stop
  // and of each other. At its time a one-off schedule is handed to the scheduler.
  async _dailyLine({ cfg, stateKey, start, code, label }) {
    if (!cfg.enabled || !start) return;
    const clock = trClock(this.now());
    const state = this.store.getSettings()[stateKey] || {};
    if (!due(clock, cfg.at, state.date)) return;
    this.store.saveSettings({ ...this.store.getSettings(), [stateKey]: { date: clock.date } });
    try {
      const item = await start();
      this._log('info', code, { time: cfg.at, count: item?.accountIds?.length ?? 0 }, `Daily ${label} started at ${cfg.at} (TR) · ${item?.accountIds?.length ?? 0} account(s)`);
    } catch (error) {
      this._log('error', code + 'Failed', { error: error.message }, `Daily ${label} could not start: ${error.message}`);
    }
    this.onChanged?.();
  }
  tickTournament() { return this._dailyLine({ cfg: this._tnCfg(), stateKey: 'dailyTournamentState', start: this.scheduleTournament, code: 'ap.dailyTournament', label: 'tournament registration' }); }
  tickPvp() { return this._dailyLine({ cfg: this._pvpCfg(), stateKey: 'dailyPvpState', start: this.schedulePvp, code: 'ap.dailyPvp', label: 'PVP' }); }

  _log(level, code, params, message) { this.activity.add({ level, accountId: null, accountName: '', taskName: 'Auto Play', code, params, message }); }

  async tick() {
    await this.tickTournament().catch(() => {});
    await this.tickPvp().catch(() => {});
    const cfg = this._cfg();
    const clock = trClock(this.now());
    const state = this._state();
    if (cfg.enabled && due(clock, cfg.stopAt, state.stopDate)) {
      const stopped = [];
      for (const account of this.store.getAccounts()) {
        const worker = this.engine.workers.get(account.id);
        const prepared = this.engine.prepared?.get(account.id);
        const active = worker && ACTIVE.includes(worker.status) ? worker : prepared;
        if (!active) continue;
        stopped.push({ accountId: account.id, taskId: active.taskId, taskName: active.taskName, visibleBrowser: Boolean(active.visibleBrowser), config: active.config || null });
        try { await this.engine.stopAccount(account.id, { reason: 'Daily Auto Play stop', quiet: true }); } catch {}
      }
      this._save({ stopDate: clock.date, resumeDate: state.resumeDate, stopped });
      this._log(stopped.length ? 'warning' : 'info', 'ap.dailyStop', { time: cfg.stopAt, count: stopped.length }, `Daily stop at ${cfg.stopAt} (TR) · ${stopped.length} account(s) stopped`);
      if (stopped.length) this.onAttention?.('autoPlayStop', String(stopped.length));
      return;
    }
    if (cfg.enabled && cfg.resumeEnabled && state.stopDate === clock.date && state.stopped.length && due(clock, cfg.resumeAt, state.resumeDate)) {
      let started = 0;
      for (const item of state.stopped) {
        if (!this.store.getAccounts().some(a => a.id === item.accountId)) continue;
        const w = this.engine.workers.get(item.accountId);
        if (w && ACTIVE.includes(w.status)) continue;
        try { await this.engine.startAccount(item.accountId, item.taskId, { visibleBrowser: item.visibleBrowser, forceFresh: false, config: item.config }); started++; } catch {}
      }
      this._save({ ...state, resumeDate: clock.date, stopped: [] });
      this._log('success', 'ap.dailyResume', { time: cfg.resumeAt, count: started }, `Auto Play started again at ${cfg.resumeAt} (TR) · ${started} account(s)`);
    }
  }
}

module.exports = { AutoPlayStop, trClock, toMinutes, due };
