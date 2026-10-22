// Built-in tasks that are not task plugins; a service runs them.
// id -> name; the runner is attached with registerBuiltin().
const BUILTIN_TASKS = {
  'tournament-register': { name: 'Turnuva kaydı / Tournament registration' },
  'market-claim': { name: 'Pazar: satışları topla / Market: claim sales' },
  'market-relist': { name: 'Pazar: dünkü ilanları tekrar listele / Market: relist yesterday\'s listings' },
  'pvp-arena': { name: 'PVP Arena' }
};

const ACTIVE_WORKER = ['running', 'preparing', 'starting'];

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Scheduled tasks: at the set time, stop whatever runs on the selected
// accounts (remembering how it ran), wait the preparation minutes, run the
// task until it completes, then start the stopped tasks again. Auto Play is
// not scheduled; it is started and stopped by hand.
class SchedulerService {
  constructor({ store, engine, activity, onChanged }) {
    this.store = store;
    this.engine = engine;
    this.activity = activity;
    this.onChanged = onChanged;
    this.timer = null;
    this.processing = new Set();
    this.builtins = new Map();
    this.controllers = new Map();
  }

  registerBuiltin(id, run) {
    if (!BUILTIN_TASKS[id]) throw new Error(`Unknown built-in task: ${id}`);
    this.builtins.set(id, { ...BUILTIN_TASKS[id], run });
  }

  // Deleting a schedule while it waits or runs stops it; what it had stopped
  // is started again.
  cancel(scheduleId) {
    this.controllers.get(scheduleId)?.abort();
  }

  start() {
    if (this.timer) return;
    this.recover().catch(() => {});
    this.timer = setInterval(() => this.tick().catch(() => {}), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list() {
    return this.store.getSchedules();
  }

  // After a restart: a task schedule that had started but not finished was
  // cut off by the app closing, so the tasks it stopped are started again.
  // Old Auto Play schedules are switched off.
  async recover() {
    const schedules = this.store.getSchedules();
    for (const schedule of schedules) {
      if (schedule.completed || !schedule.enabled) continue;
      if (schedule.scheduleType !== 'task') {
        this._update(schedule.id, { enabled: false, phase: 'done', result: 'disabled', message: 'Auto Play is no longer scheduled' });
        this._log(schedule, 'warning', 'Auto Play schedules are no longer supported; this one was switched off.', null, 'sc.autoplayDisabled');
        continue;
      }
      if (!schedule.started) continue;
      this._log(schedule, 'warning', 'was interrupted when the app closed.', null, 'sc.interrupted');
      await this._restore(schedule, schedule.resume || []);
      this._update(schedule.id, { phase: 'done', completed: true, completedAt: new Date().toISOString(), result: 'interrupted', message: 'Interrupted' });
    }
  }

  async tick() {
    const now = Date.now();
    const schedules = this.store.getSchedules();
    for (const schedule of schedules) {
      if (!schedule.enabled || schedule.completed || schedule.started || schedule.scheduleType !== 'task') continue;
      const startAt = new Date(schedule.startAt).getTime();
      if (!Number.isFinite(startAt) || now < startAt || this.processing.has(schedule.id)) continue;
      this.processing.add(schedule.id);
      schedule.started = true;
      this.store.saveSchedules(schedules);
      this.onChanged?.();
      this.runTaskSchedule(schedule)
        .catch(() => {})
        .finally(() => this.processing.delete(schedule.id));
    }
  }

  _log(schedule, level, message, account = null, code = null, params = {}) {
    const task = schedule.taskName || schedule.name;
    this.activity.add({
      level, accountId: account?.id || `schedule:${schedule.id}`, accountName: account?.name || '',
      taskId: schedule.taskId, taskName: 'Schedule', message: `${task}: ${message}`,
      code, params: code ? { schedule: task, ...params } : null
    });
  }

  _update(scheduleId, patch) {
    const schedules = this.store.getSchedules();
    const item = schedules.find(s => s.id === scheduleId);
    if (!item) return null;
    Object.assign(item, patch);
    this.store.saveSchedules(schedules);
    this.onChanged?.();
    return item;
  }

  async _restore(schedule, resume) {
    const accounts = this.store.getAccounts();
    for (const item of resume) {
      const account = accounts.find(a => a.id === item.accountId);
      if (!account) continue;
      try {
        await this.engine.startAccount(item.accountId, item.taskId, { visibleBrowser: item.visibleBrowser, forceFresh: false, config: item.config });
        this._log(schedule, 'success', `${item.taskName} started again.`, account, 'sc.restarted', { task: item.taskName });
      } catch (error) {
        this._log(schedule, 'error', `${item.taskName} could not be started again: ${error.message}`, account, 'sc.restartFailed', { task: item.taskName, error: error.message });
      }
    }
  }

  async runTaskSchedule(schedule) {
    const controller = new AbortController();
    const { signal } = controller;
    this.controllers.set(schedule.id, controller);
    const accounts = this.store.getAccounts().filter(a => schedule.accountIds.includes(a.id));
    const resume = [];
    let result = 'completed';
    try {
      for (const account of accounts) {
        const worker = this.engine.workers.get(account.id);
        const prepared = this.engine.prepared.get(account.id);
        const active = worker && ACTIVE_WORKER.includes(worker.status) ? worker : prepared;
        if (!active || active.taskId === schedule.taskId) continue;
        resume.push({ accountId: account.id, taskId: active.taskId, taskName: active.taskName, visibleBrowser: Boolean(active.visibleBrowser), config: active.config || null });
      }
      // Saved first so a restart in the middle can still start them again.
      this._update(schedule.id, { phase: 'stopping', resume, message: resume.length ? `Stopping ${resume.length} running task(s)…` : 'Nothing to stop.' });
      for (const item of resume) {
        const account = accounts.find(a => a.id === item.accountId);
        await this.engine.stopAccount(item.accountId, { reason: `Stopped for scheduled ${schedule.taskName}`, quiet: true });
        this._log(schedule, 'info', `stopped ${item.taskName} · it will start again when the task is done.`, account, 'sc.stopped', { task: item.taskName });
      }

      const preparationMs = Math.max(0, Number(schedule.preparationMinutes || 0)) * 60000;
      if (preparationMs > 0) {
        const runAt = new Date(Date.now() + preparationMs).toISOString();
        this._update(schedule.id, { phase: 'preparing', runAt, message: `Preparing · starts at ${new Date(runAt).toLocaleTimeString()}` });
        this._log(schedule, 'info', `preparing for ${schedule.preparationMinutes} min · ${accounts.length} account(s).`, null, 'sc.preparing', { minutes: schedule.preparationMinutes, count: accounts.length });
        await sleep(preparationMs, signal);
      }

      this._update(schedule.id, { phase: 'running', message: 'Running…' });
      this._log(schedule, 'info', `started · ${accounts.length} account(s).`, null, 'sc.started', { count: accounts.length });
      const builtin = this.builtins.get(schedule.taskId);
      if (builtin) await builtin.run(accounts.map(a => a.id), { signal });
      else await this._runPluginTask(schedule, accounts, signal);
      if (signal.aborted) throw abortError();
      this._log(schedule, 'success', 'task completed.', null, 'sc.completed');
      result = 'completed';
    } catch (error) {
      if (error?.name === 'AbortError') { this._log(schedule, 'warning', 'cancelled.', null, 'sc.cancelled'); result = 'cancelled'; }
      else { this._log(schedule, 'error', `failed: ${error.message}`, null, 'sc.failed', { error: error.message }); result = 'failed'; }
    } finally {
      this.controllers.delete(schedule.id);
      this._update(schedule.id, { phase: 'restoring', message: resume.length ? `Starting ${resume.length} task(s) again…` : 'Finishing…' });
      await this._restore(schedule, resume);
      this._update(schedule.id, { phase: 'done', completed: true, completedAt: new Date().toISOString(), result, message: signal.aborted ? 'Cancelled' : 'Completed' });
    }
  }

  async _runPluginTask(schedule, accounts, signal) {
    const run = async account => {
      if (signal.aborted) return;
      try {
        await this.engine.startAccount(account.id, schedule.taskId, {
          visibleBrowser: Boolean(schedule.visibleBrowser), forceFresh: true, config: schedule.taskConfig || null
        });
        const worker = this.engine.workers.get(account.id);
        const onAbort = () => this.engine.stopAccount(account.id, { reason: 'Schedule cancelled', quiet: true });
        signal.addEventListener('abort', onAbort, { once: true });
        try { if (worker?.donePromise) await worker.donePromise; }
        finally { signal.removeEventListener('abort', onAbort); }
      } catch (error) {
        this._log(schedule, 'error', `failed: ${error.message}`, account, 'sc.failed', { error: error.message });
      }
    };
    if ((schedule.executionMode || 'parallel') === 'parallel') {
      await Promise.all(accounts.map(run));
      return;
    }
    const delayMs = Math.max(0, Number(schedule.delaySeconds || 0)) * 1000;
    for (let i = 0; i < accounts.length; i++) {
      await run(accounts[i]);
      if (delayMs && i < accounts.length - 1) await sleep(delayMs, signal);
    }
  }
}

module.exports = { SchedulerService, BUILTIN_TASKS };
