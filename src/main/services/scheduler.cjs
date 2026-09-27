class SchedulerService {
  constructor({ store, engine, activity, onChanged }) {
    this.store = store;
    this.engine = engine;
    this.activity = activity;
    this.onChanged = onChanged;
    this.timer = null;
    this.processing = new Set();
    this.preparationPromises = new Map();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list() {
    return this.store.getSchedules();
  }

  async tick() {
    const now = Date.now();
    const schedules = this.store.getSchedules();
    let changed = false;

    for (const schedule of schedules) {
      if (!schedule.enabled || schedule.completed) continue;
      const startAt = new Date(schedule.startAt).getTime();
      if (!Number.isFinite(startAt)) continue;
      const prepMin = Number(schedule.preparationMinutes ?? 6);
      const prepAt = startAt - prepMin * 60000;

      if (!schedule.prepared && now >= prepAt && now < startAt) {
        if (!this.processing.has(`${schedule.id}:prepare`)) {
          this.processing.add(`${schedule.id}:prepare`);
          schedule.prepared = true;
          schedule.preparingAt = new Date().toISOString();
          changed = true;
          this.store.saveSchedules(schedules);
          this.onChanged?.();

          const prepPromise = this.prepareSchedule(schedule)
            .catch(() => {})
            .finally(() => {
              this.processing.delete(`${schedule.id}:prepare`);
              this.preparationPromises.delete(schedule.id);
            });
          this.preparationPromises.set(schedule.id, prepPromise);
        }
      }

      if (now >= startAt && !schedule.started) {
        if (!this.processing.has(`${schedule.id}:start`)) {
          this.processing.add(`${schedule.id}:start`);
          schedule.started = true;
          changed = true;
          this.store.saveSchedules(schedules);
          this.onChanged?.();

          this.startSchedule(schedule)
            .catch(() => {})
            .finally(() => this.processing.delete(`${schedule.id}:start`));
        }
      }
    }

    if (changed) this.store.saveSchedules(schedules);
  }

  async prepareSchedule(schedule) {
    const accounts = this.store.getAccounts().filter(a => schedule.accountIds.includes(a.id));
    const staggerMs = Math.max(0, Number(this.store.getSettings().loginStaggerSeconds || 3) * 1000);

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      try {
        await this.engine.prepareAccount(account.id, schedule.taskId, {
          visibleBrowser: Boolean(schedule.visibleBrowser),
          forceFresh: true,
          activateAt: schedule.startAt,
          config: schedule.taskConfig || null
        });
      } catch (error) {
        this.activity.add({
          level: 'error',
          accountId: account.id,
          accountName: account.name,
          taskId: schedule.taskId,
          taskName: schedule.taskName || '',
          message: `Schedule preparation failed: ${error.message}`
        });
      }
      if (staggerMs && i < accounts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, staggerMs));
      }
    }
  }

  async startSchedule(schedule) {
    const prepPromise = this.preparationPromises.get(schedule.id);
    if (prepPromise) await prepPromise;
    const accounts = this.store.getAccounts().filter(a => schedule.accountIds.includes(a.id));
    const mode = schedule.executionMode || 'parallel';
    const delayMs = Math.max(0, Number(schedule.delaySeconds || 0) * 1000);

    if (mode === 'parallel') {
      await Promise.allSettled(accounts.map(async account => {
        try {
          if (this.engine.prepared.has(account.id)) {
            await this.engine.activatePrepared(account.id);
          } else {
            await this.engine.startAccount(account.id, schedule.taskId, {
              visibleBrowser: Boolean(schedule.visibleBrowser),
              forceFresh: true,
              config: schedule.taskConfig || null
            });
          }
        } catch (error) {
          this.activity.add({
            level: 'error',
            accountId: account.id,
            accountName: account.name,
            taskId: schedule.taskId,
            taskName: schedule.taskName || '',
            message: `Scheduled start failed: ${error.message}`
          });
        }
      }));
    } else {
      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        try {
          if (this.engine.prepared.has(account.id)) {
            await this.engine.activatePrepared(account.id);
          } else {
            await this.engine.startAccount(account.id, schedule.taskId, {
              visibleBrowser: Boolean(schedule.visibleBrowser),
              forceFresh: true,
              config: schedule.taskConfig || null
            });
          }
        } catch (error) {
          this.activity.add({
            level: 'error',
            accountId: account.id,
            accountName: account.name,
            taskId: schedule.taskId,
            taskName: schedule.taskName || '',
            message: `Scheduled start failed: ${error.message}`
          });
        }
        if (delayMs && i < accounts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    const schedules = this.store.getSchedules();
    const item = schedules.find(s => s.id === schedule.id);
    if (item) {
      item.completed = true;
      item.completedAt = new Date().toISOString();
      this.store.saveSchedules(schedules);
      this.onChanged?.();
    }
  }
}

module.exports = { SchedulerService };
