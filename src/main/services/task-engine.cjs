const { io } = require('socket.io-client');

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class TaskEngine {
  constructor({ store, credentials, registry, browserService, activity, onChanged, beforeRun = null, beforeRunNextAt = null }) {
    this.store = store;
    // Optional `async ({ account, taskId, signal }) => {}` run before a task's loop
    // (the daily routine) and again at `beforeRunNextAt(accountId)` while it runs.
    // Only an abort stops the task; other errors are ignored.
    this.beforeRun = beforeRun;
    this.beforeRunNextAt = beforeRunNextAt;
    this.gates = new Map(); // accountId -> promise of a running routine
    this.credentials = credentials;
    this.registry = registry;
    this.browserService = browserService;
    this.activity = activity;
    this.onChanged = onChanged;
    this.workers = new Map();
    this.prepared = new Map();
  }

  states() {
    const result = {};
    for (const [accountId, worker] of this.workers) {
      result[accountId] = {
        status: worker.status,
        taskId: worker.taskId,
        taskName: worker.taskName,
        mode: worker.mode || '',
        message: worker.message || '',
        phase: worker.phase || null,
        startedAt: worker.startedAt || null,
        lastActionAt: worker.lastActionAt || null,
        nextActionAt: worker.nextActionAt || null
      };
    }
    for (const [accountId, prepared] of this.prepared) {
      if (!result[accountId]) {
        result[accountId] = {
          status: 'preparing',
          taskId: prepared.taskId,
          taskName: prepared.taskName,
          mode: prepared.mode || '',
          message: prepared.message || 'Prepared',
          startedAt: null,
          lastActionAt: null,
          nextActionAt: prepared.activateAt || null
        };
      }
    }
    return result;
  }

  accountById(id) {
    const account = this.store.getAccounts().find(a => a.id === id);
    if (!account) throw new Error('Account not found.');
    return account;
  }

  buildRuntime(account, manifest, worker, signal) {
    const log = (level, message) => {
      worker.message = String(message);
      this.activity.add({
        level,
        accountId: account.id,
        accountName: account.name,
        taskId: manifest.id,
        taskName: manifest.name,
        message
      });
      this.onChanged?.();
    };

    const alert = (alertType, message) => {
      worker.message = String(message);
      this.activity.add({
        level: 'error',
        accountId: account.id,
        accountName: account.name,
        taskId: manifest.id,
        taskName: manifest.name,
        message,
        alertType
      });
      this.onChanged?.();
    };

    return {
      account: {
        id: account.id,
        name: account.name,
        login: account.login,
        visibleBrowser: Boolean(account.visibleBrowser)
      },
      manifest,
      signal,
      browser: this.browserService,
      sleep: async (ms) => {
        await sleep(ms, signal);
        for (let gate; (gate = this.gates.get(account.id));) {
          await gate;
          if (signal.aborted) throw abortError();
        }
      },
      now: () => Date.now(),
      log,
      alert,
      setState: (patch = {}) => {
        Object.assign(worker, patch);
        this.onChanged?.();
      },
      credentials: () => ({
        login: account.login,
        password: this.credentials.decryptSecret(account.passwordEncrypted)
      }),
      socket: {
        create: (url, options) => io(url, options)
      }
    };
  }

  async prepareAccount(accountId, taskId, { visibleBrowser, forceFresh = false, activateAt = null, config = null } = {}) {
    await this.stopAccount(accountId, { reason: 'Preparing a scheduled task', quiet: true });
    await this.disposePrepared(accountId);

    const account = this.accountById(accountId);
    const { plugin, manifest } = this.registry.load(taskId);
    const controller = new AbortController();
    const worker = {
      accountId,
      taskId,
      taskName: manifest.name,
      status: 'preparing',
      mode: '',
      message: 'Preparing…',
      controller,
      startedAt: null,
      config: config || account.taskConfig?.[taskId] || manifest.defaultConfig || {}
    };
    const runtime = this.buildRuntime(account, manifest, worker, controller.signal);
    const visible = visibleBrowser ?? Boolean(account.visibleBrowser);

    this.prepared.set(accountId, {
      ...worker,
      runtime,
      plugin,
      manifest,
      visibleBrowser: visible,
      activateAt
    });
    this.onChanged?.();

    this.activity.add({
      level: 'warning',
      accountId,
      accountName: account.name,
      taskId,
      taskName: manifest.name,
      message: `Preparing ${manifest.name}…`
    });

    try {
      const preparedData = await plugin.prepare({
        ...runtime,
        config: worker.config,
        visibleBrowser: visible,
        forceFresh
      });
      const entry = this.prepared.get(accountId);
      if (!entry || controller.signal.aborted) {
        if (plugin.disposePrepared) await plugin.disposePrepared(preparedData, runtime).catch(() => {});
        throw abortError();
      }
      entry.preparedData = preparedData;
      entry.mode = preparedData?.mode || '';
      entry.message = 'Ready to start';
      this.activity.add({
        level: 'success',
        accountId,
        accountName: account.name,
        taskId,
        taskName: manifest.name,
        message: `${manifest.name} is ready.`
      });
      this.onChanged?.();
      return true;
    } catch (error) {
      this.prepared.delete(accountId);
      if (error?.name !== 'AbortError') {
        this.activity.add({
          level: 'error',
          accountId,
          accountName: account.name,
          taskId,
          taskName: manifest.name,
          message: `Preparation failed: ${error.message}`
        });
      }
      this.onChanged?.();
      throw error;
    }
  }

  async activatePrepared(accountId) {
    const entry = this.prepared.get(accountId);
    if (!entry) throw new Error('No prepared task for this account.');
    this.prepared.delete(accountId);

    const worker = {
      ...entry,
      status: 'running',
      message: 'Running',
      startedAt: new Date().toISOString(),
      lastActionAt: null,
      nextActionAt: null
    };
    this.workers.set(accountId, worker);
    this.onChanged?.();

    const account = this.accountById(accountId);
    this.activity.add({
      level: 'success',
      accountId,
      accountName: account.name,
      taskId: worker.taskId,
      taskName: worker.taskName,
      message: `${worker.taskName} started.`
    });

    worker.donePromise = (async () => {
      try {
        if (this.beforeRun) {
          await this._runBeforeRun(worker, account);
          if (worker.controller.signal.aborted) throw abortError();
          this._scheduleBeforeRun(worker, account);
        }
        await worker.plugin.run({
          ...worker.runtime,
          config: worker.config,
          visibleBrowser: worker.visibleBrowser
        }, worker.preparedData);
      } catch (error) {
        if (error?.name !== 'AbortError') {
          worker.status = 'error';
          worker.message = error.message;
          if (!error?.suppressEngineLog) {
            this.activity.add({
              level: 'error',
              accountId,
              accountName: account.name,
              taskId: worker.taskId,
              taskName: worker.taskName,
              message: error.message
            });
          }
        }
      } finally {
        clearTimeout(worker.beforeRunTimer);
        worker.beforeRunTimer = null;
        try {
          if (worker.plugin.disposePrepared) {
            await worker.plugin.disposePrepared(worker.preparedData, worker.runtime);
          }
        } catch {}
        const current = this.workers.get(accountId);
        if (current === worker) {
          this.workers.delete(accountId);
          if (worker.status !== 'error') {
            this.activity.add({
              level: 'info',
              accountId,
              accountName: account.name,
              taskId: worker.taskId,
              taskName: worker.taskName,
              message: `${worker.taskName} stopped.`
            });
          }
          this.onChanged?.();
        }
      }
    })();

    return true;
  }

  // Runs the daily routine while the task's own loop waits: ctx.sleep() does not
  // return while a gate is set for the account, so no new action starts meanwhile.
  _runBeforeRun(worker, account) {
    const gate = (async () => {
      worker.phase = 'daily';
      this.onChanged?.();
      try {
        await this.beforeRun({ account, taskId: worker.taskId, signal: worker.controller.signal });
      } catch {
        // Abort is seen by the caller through the signal; other errors never stop the task.
      } finally {
        worker.phase = null;
        if (this.gates.get(account.id) === gate) this.gates.delete(account.id);
        this.onChanged?.();
      }
    })();
    this.gates.set(account.id, gate);
    return gate;
  }

  // While the task runs, the routine runs again at the next due time (19:12 TR).
  _scheduleBeforeRun(worker, account, at = null) {
    if (!this.beforeRunNextAt || worker.controller.signal.aborted) return;
    clearTimeout(worker.beforeRunTimer);
    const delay = Math.max(1000, Number(at ?? this.beforeRunNextAt(account.id)) - Date.now());
    worker.beforeRunTimer = setTimeout(async () => {
      if (this.workers.get(account.id) !== worker || worker.controller.signal.aborted) return;
      await this._runBeforeRun(worker, account);
      this._scheduleBeforeRun(worker, account);
    }, Math.min(delay, 2 ** 31 - 1));
    worker.beforeRunTimer.unref?.();
  }

  // Look at the routine again now (e.g. the account was just ticked for it).
  recheckBeforeRun(accountId) {
    const worker = this.workers.get(accountId);
    if (!worker || !this.beforeRun || this.gates.has(accountId) || worker.beforeRunTimer == null) return;
    this._scheduleBeforeRun(worker, this.accountById(accountId), Date.now());
  }

  async startAccount(accountId, taskId, options = {}) {
    await this.prepareAccount(accountId, taskId, options);
    return this.activatePrepared(accountId);
  }

  async stopAccount(accountId, { reason = 'Stopped by user', quiet = false } = {}) {
    const prepared = this.prepared.get(accountId);
    if (prepared) {
      prepared.controller.abort();
      try {
        if (prepared.plugin.disposePrepared && prepared.preparedData) {
          await prepared.plugin.disposePrepared(prepared.preparedData, prepared.runtime);
        }
      } catch {}
      this.prepared.delete(accountId);
    }

    const worker = this.workers.get(accountId);
    if (!worker) {
      this.onChanged?.();
      return;
    }

    worker.status = 'stopping';
    worker.message = reason;
    worker.controller.abort();
    this.onChanged?.();

    if (!quiet) {
      const account = this.accountById(accountId);
      this.activity.add({
        level: 'warning',
        accountId,
        accountName: account.name,
        taskId: worker.taskId,
        taskName: worker.taskName,
        message: reason
      });
    }

    if (worker.donePromise) {
      await Promise.race([
        worker.donePromise.catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 10000))
      ]);
    }
  }

  async disposePrepared(accountId) {
    const entry = this.prepared.get(accountId);
    if (!entry) return;
    entry.controller.abort();
    try {
      if (entry.plugin.disposePrepared && entry.preparedData) {
        await entry.plugin.disposePrepared(entry.preparedData, entry.runtime);
      }
    } catch {}
    this.prepared.delete(accountId);
    this.onChanged?.();
  }

  async stopAll() {
    const ids = new Set([...this.workers.keys(), ...this.prepared.keys()]);
    for (const id of ids) {
      await this.stopAccount(id, { reason: 'Application closing', quiet: true });
    }
  }
}

module.exports = { TaskEngine, sleep };
