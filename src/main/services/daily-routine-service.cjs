const { GameSocket } = require('./game-socket.cjs');
const { lastExpiryCutoff } = require('./market-service.cjs');

// Once per game day (after the 19:10 TR reset) Auto Play first runs the daily
// routine for the selected accounts: Daily Signin, 600-Day Sign In, starting
// the daily tasks and one Friendly Match. Everything goes through the game's
// socket / HTTP API; every step is safe to repeat ("already done" answers).
const SIGNIN_600_URL = 'https://www.dreamteamph.com/api/daily-signin-600';
const DEFAULT_TIMING = {
  pollMs: 3000,
  busyWaitMs: 10 * 60 * 1000,     // a Quick Play match still running from before
  busyRetryMs: 30 * 1000,         // "create match" refused while that match runs
  opponentWaitMs: 10 * 60 * 1000, // nobody joined our match → cancel and look again
  matchWaitMs: 20 * 60 * 1000,    // one Friendly Match takes a few minutes
  appearMs: 90 * 1000,            // a joined match must show up as active by then
  totalMs: 40 * 60 * 1000         // after this Auto Play goes on; the next start retries
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_DELAY_MS = 2 * 60 * 1000;   // runs at 19:12 TR, after the game's reset settles
const RETRY_MS = 30 * 60 * 1000;      // an incomplete routine is tried again after this
const RECHECK_MS = 60 * 60 * 1000;    // and the schedule is looked at again at least hourly
const REWARD_CHECK_MS = 30 * 60 * 1000; // while Auto Play runs, finished task rewards are claimed this often

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Claim All answers { claimedCount, rewards:{xp, items[{itemName, amount}]} };
// a single claim answers { rewards:[{type:'XP'|'ITEM', amount, item:{name}}] }.
function rewardSummary(reply, task) {
  const add = (map, name, n) => map.set(name, (map.get(name) || 0) + (Number(n) || 0));
  const items = new Map();
  let xp = 0;
  if (Array.isArray(reply?.rewards)) {
    for (const r of reply.rewards) {
      if (r.type === 'XP') xp += Number(r.amount) || 0;
      else if (r.item?.name || r.itemName) add(items, r.item?.name || r.itemName, r.amount);
    }
  } else {
    xp = Number(reply?.rewards?.xp) || 0;
    for (const it of reply?.rewards?.items || []) add(items, it.itemName, it.amount);
  }
  return {
    count: Number(reply?.claimedCount) || (task ? 1 : 0),
    xp,
    items: [...items].map(([name, n]) => `${n} ${name}`).join(', ')
  };
}

const isFmEntry = m => m?.type === 'FM' || /^fm-/.test(String(m?.match_id || ''));
const reasonOf = r => String(r?.error || r?.message || 'rejected');

class DailyRoutineService {
  constructor({ store, activity, sessions, onChanged, createSocket, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), timing = {} }) {
    this.store = store;
    this.activity = activity;
    this.sessions = sessions;
    this.onChanged = onChanged;
    this.createSocket = createSocket;
    this.fetch = fetchImpl;
    this.now = now;
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.live = new Map(); // accountId -> { status, step, stepParams, error }
    this.lastClaimCheck = new Map(); // accountId -> ms of the last task reward check
  }

  // Never configured → every account; the Daily column can untick them.
  selectedIds() {
    const ids = this.store.getSettings().dailyRoutineAccountIds;
    if (Array.isArray(ids)) return ids;
    return (this.store.getAccounts?.() || []).map(a => a.id);
  }

  cycle() { return new Date(lastExpiryCutoff(this.now())).toISOString(); }

  _saved(accountId) { return this.store.getDailyRoutine().accounts?.[accountId] || null; }

  _save(accountId, entry) {
    const saved = this.store.getDailyRoutine();
    this.store.saveDailyRoutine({ ...saved, version: 1, accounts: { ...(saved.accounts || {}), [accountId]: entry } });
  }

  // When a running Auto Play should run the routine next (TaskEngine timer).
  // runIfDue() decides for itself, so an early or extra call does nothing.
  nextDueAt(accountId) {
    const now = this.now();
    const boundary = lastExpiryCutoff(now) + RUN_DELAY_MS;
    let next = now < boundary ? boundary : boundary + DAY_MS;
    const saved = this._saved(accountId);
    if (now >= boundary && this.selectedIds().includes(accountId) && !this.doneThisCycle(accountId)) {
      const failedAt = saved?.failedCycle === this.cycle() ? Date.parse(saved.failedAt) : NaN;
      next = Number.isFinite(failedAt) ? failedAt + RETRY_MS : now;
    }
    if (this.selectedIds().includes(accountId)) {
      const last = this.lastClaimCheck.get(accountId);
      next = Math.min(next, last == null ? now : Math.max(now, last + REWARD_CHECK_MS));
    }
    return Math.min(next, now + RECHECK_MS);
  }

  doneThisCycle(accountId) { return this._saved(accountId)?.cycle === this.cycle(); }

  snapshot() {
    const cycle = this.cycle();
    const accounts = {};
    for (const id of new Set([...this.selectedIds(), ...this.live.keys()])) {
      const saved = this._saved(id);
      const live = this.live.get(id);
      const done = saved?.cycle === cycle;
      accounts[id] = live || (done
        ? { status: 'done', doneAt: saved.doneAt, results: saved.results }
        : { status: saved?.failedCycle === cycle ? 'error' : 'pending', error: saved?.failedCycle === cycle ? saved.error : null });
      if (saved?.rewards?.cycle === cycle) accounts[id] = { ...accounts[id], rewards: { count: saved.rewards.count, xp: saved.rewards.xp, at: saved.rewards.at } };
    }
    // Task lists for every account (not only the ticked ones), from today's game day.
    const tasks = {};
    for (const [id, saved] of Object.entries(this.store.getDailyRoutine().accounts || {})) {
      if (saved?.tasks?.cycle === cycle) tasks[id] = saved.tasks;
    }
    return { cycle, selected: this.selectedIds(), accounts, tasks };
  }

  _step(account, step, stepParams = {}) {
    this.live.set(account.id, { status: 'working', step, stepParams });
    this.onChanged?.();
  }

  _log(account, level, code, params, message) {
    this.activity.add({ level, accountId: account.id, accountName: account.name, code, params, message });
  }

  // Called before an Auto Play task starts its loop. Never throws except on abort,
  // so a failed routine never keeps Auto Play from starting.
  async runIfDue(account, { signal } = {}) {
    if (!this.selectedIds().includes(account.id)) return null;
    if (this.doneThisCycle(account.id)) {
      // Routine done today: only collect rewards of tasks finished since the last check.
      const last = this.lastClaimCheck.get(account.id);
      if (last == null || this.now() - last >= REWARD_CHECK_MS) await this._claimSafely(account, signal);
      return null;
    }
    const cycle = this.cycle();
    const results = {};
    const failed = [];
    let main = null;
    let sim = null;
    this._log(account, 'info', 'dr.start', {}, 'Daily routine started');
    try {
      this._step(account, 'login');
      const session = await this.sessions.get(account, { owner: 'daily-routine' });
      const { userId, cookieHeader: cookie } = session;
      main = await GameSocket.open({ createSocket: this.createSocket, cookie, signal });

      const steps = [
        ['signIn', () => this._signIn(account, main, userId, signal)],
        ['signIn600', () => this._signIn600(account, userId, cookie)],
        ['tasks', () => this._startTasks(account, main, userId, signal)],
        ['friendly', async () => {
          if (await this._taskDone(main, userId, 'friendly_match', signal)) return 'already';
          sim = await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/', cookie, signal });
          return this._friendlyMatch(account, sim, main, userId, signal);
        }]
      ];
      for (const [key, run] of steps) {
        try {
          results[key] = await run();
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          results[key] = 'failed';
          failed.push(key);
          this._log(account, 'error', `dr.${key}Failed`, { error: error.message }, `Daily routine · ${key} failed: ${error.message}`);
        }
      }
      // Collect what is finished by now (the Friendly Match task at least). A failure
      // here does not make the routine incomplete; the next check tries again.
      try { await this._claimWith(account, main, userId, signal); } catch (error) {
        if (error?.name === 'AbortError') throw error;
        this._log(account, 'error', 'dr.rewardsFailed', { error: error.message }, `Task rewards could not be claimed: ${error.message}`);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        this.live.delete(account.id);
        this._log(account, 'warning', 'dr.stopped', {}, 'Daily routine stopped');
        this.onChanged?.();
        throw error;
      }
      if (/auth|session|login/i.test(error.message)) this.sessions.invalidate?.(account.id);
      failed.push('session');
      results.error = error.message;
      this._log(account, 'error', 'dr.failed', { error: error.message }, `Daily routine failed: ${error.message}`);
    } finally {
      try { main?.close(); } catch {}
      try { sim?.close(); } catch {}
    }

    this.live.delete(account.id);
    if (failed.length) {
      this._save(account.id, { ...(this._saved(account.id) || {}), failedCycle: cycle, failedAt: new Date(this.now()).toISOString(), error: results.error || failed.join(', '), results });
      this._log(account, 'warning', 'dr.partial', { failed: failed.join(', ') }, `Daily routine incomplete (${failed.join(', ')}); it will be retried at the next Auto Play start`);
    } else {
      const keep = this._saved(account.id) || {};
      this._save(account.id, { rewards: keep.rewards, tasks: keep.tasks, cycle, doneAt: new Date(this.now()).toISOString(), results });
      this._log(account, 'success', 'dr.done', {}, 'Daily routine finished · Auto Play continues');
    }
    this.onChanged?.();
    return results;
  }

  // Daily task rewards (Claim All when several are ready, Obtain for a single one).
  // Manual use: the Auto Play page's "collect rewards" button, for any accounts.
  async claimRewards(accountIds) {
    const accounts = this.store.getAccounts().filter(a => accountIds.includes(a.id));
    const out = {};
    for (const account of accounts) out[account.id] = await this._claimSafely(account, null);
    return out;
  }

  async _claimSafely(account, signal) {
    let main = null;
    try {
      const { userId, cookieHeader: cookie } = await this.sessions.get(account, { owner: 'daily-routine' });
      main = await GameSocket.open({ createSocket: this.createSocket, cookie, signal });
      return await this._claimWith(account, main, userId, signal);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      this.lastClaimCheck.set(account.id, this.now()); // do not retry at once; next check in 30 min
      this._log(account, 'error', 'dr.rewardsFailed', { error: error.message }, `Task rewards could not be claimed: ${error.message}`);
      return { error: error.message };
    } finally {
      try { main?.close(); } catch {}
      if (this.live.get(account.id)?.step === 'rewards') { this.live.delete(account.id); this.onChanged?.(); }
    }
  }

  // The task list as the page shows it (daily + alliance), kept per game day.
  _saveTasks(accountId, reply) {
    const list = Array.isArray(reply?.tasks) ? reply.tasks.map(t => ({
      taskId: t.taskId,
      key: t.task?.key,
      title: t.task?.title || t.task?.key,
      progress: Number(t.progress) || 0,
      required: Number(t.task?.required) || 1,
      completed: Boolean(t.completed),
      claimed: Boolean(t.isClaimed),
      alliance: t.task?.taskType === 'ALLIANCE'
    })) : [];
    const saved = this._saved(accountId) || {};
    this._save(accountId, { ...saved, tasks: { cycle: this.cycle(), at: new Date(this.now()).toISOString(), needsStart: Boolean(reply?.needsStart), list } });
    this.onChanged?.();
  }

  // Read-only: the task list needs only the user id, so every account is read
  // over one socket without signing in (the session cookie is the fallback).
  async refreshTasks(accountIds) {
    const accounts = this.store.getAccounts().filter(a => accountIds.includes(a.id));
    const profile = this.store.getAccountProfile?.()?.accounts || {};
    let open = null;
    const out = {};
    try {
      for (const account of accounts) {
        try {
          let userId = profile[account.id]?.userId;
          let reply = null;
          if (userId) {
            open = open || await GameSocket.open({ createSocket: this.createSocket });
            reply = await open.ack('getDailyTasks', { userId }, { timeoutMs: 8000 }).catch(() => null);
          }
          if (!reply) {
            const session = await this.sessions.get(account, { owner: 'daily-routine' });
            userId = session.userId;
            const conn = await GameSocket.open({ createSocket: this.createSocket, cookie: session.cookieHeader });
            try { reply = await conn.ack('getDailyTasks', { userId }); } finally { conn.close(); }
          }
          this._saveTasks(account.id, reply);
          out[account.id] = true;
        } catch (error) {
          out[account.id] = error.message;
        }
      }
    } finally {
      try { open?.close(); } catch {}
    }
    return out;
  }

  async _claimWith(account, main, userId, signal) {
    this._step(account, 'rewards');
    const current = await this._dailyTasks(main, userId, signal);
    const { tasks } = current;
    this._saveTasks(account.id, current);
    this.lastClaimCheck.set(account.id, this.now());
    const ready = (tasks || []).filter(t => t.completed && !t.isClaimed);
    if (!ready.length) return { count: 0 };
    const reply = ready.length > 1
      ? await this._claimAck(main, 'claimAllDailyTaskRewards', { userId }, signal)
      : await this._claimAck(main, 'claimDailyTaskReward', { userId, taskId: ready[0].taskId }, signal);
    if (!reply?.success) {
      if (/no completed tasks|already claimed/i.test(reasonOf(reply))) return { count: 0 };
      throw new Error(reasonOf(reply));
    }
    const sum = rewardSummary(reply, ready.length > 1 ? null : ready[0]);
    const cycle = this.cycle();
    const saved = this._saved(account.id) || {};
    const claimedIds = new Set(ready.map(t => t.taskId));
    if (saved.tasks?.list) saved.tasks = { ...saved.tasks, list: saved.tasks.list.map(t => claimedIds.has(t.taskId) ? { ...t, claimed: true } : t) };
    const before = saved.rewards?.cycle === cycle ? saved.rewards : { count: 0, xp: 0 };
    this._save(account.id, { ...saved, rewards: { cycle, count: before.count + sum.count, xp: before.xp + sum.xp, at: new Date(this.now()).toISOString() } });
    this._log(account, 'success', 'dr.rewardsClaimed', { count: sum.count, xp: sum.xp, items: sum.items || '—' }, `Task rewards claimed · ${sum.count} task(s) · ${sum.xp} XP · ${sum.items}`);
    this.onChanged?.();
    return sum;
  }

  // Claims have the game's ~2 s cooldown ("Please wait N seconds…", retryAfter).
  async _claimAck(main, event, payload, signal) {
    for (let attempt = 0; ; attempt++) {
      const r = await main.ack(event, payload, { signal });
      const wait = r?.retryAfter ?? Number(String(r?.error || '').match(/please wait (\d+)/i)?.[1]);
      if (r?.success === false && Number.isFinite(wait) && attempt < 5) { await sleep(wait * 1000 + 250, signal); continue; }
      return r;
    }
  }

  async _signIn(account, main, userId, signal) {
    this._step(account, 'signIn');
    const status = await main.call('getSignInStatus', { userId }, 'dailySignIn:data', { signal });
    if (status?.hasClaimedToday) {
      this._log(account, 'info', 'dr.signInAlready', {}, 'Daily Signin was already claimed today');
      return 'already';
    }
    const reply = await this._race(main, 'claimSignInReward', { userId }, ['dailySignIn:claimed', 'dailySignIn:error'], signal);
    if (reply.event === 'dailySignIn:error') {
      if (/already/i.test(String(reply.data))) return 'already';
      throw new Error(String(reply.data?.message || reply.data || 'Daily Signin refused'));
    }
    this._log(account, 'success', 'dr.signIn', { day: reply.data?.currentDay ?? '?' }, `Daily Signin claimed · day ${reply.data?.currentDay ?? '?'}`);
    return 'claimed';
  }

  // Emits once and resolves with whichever of `events` arrives first.
  _race(conn, event, payload, events, signal, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const socket = conn.socket;
      const handlers = events.map(name => [name, data => finish(null, { event: name, data })]);
      const timer = setTimeout(() => finish(new Error(`No reply to ${event}.`)), timeoutMs);
      const onAbort = () => finish(abortError());
      function finish(error, value) {
        clearTimeout(timer);
        for (const [name, fn] of handlers) socket.off(name, fn);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(value);
      }
      for (const [name, fn] of handlers) socket.on(name, fn);
      signal?.addEventListener('abort', onAbort, { once: true });
      socket.emit(event, payload);
    });
  }

  async _signIn600(account, userId, cookie) {
    this._step(account, 'signIn600');
    const res = await this.fetch(`${SIGNIN_600_URL}/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: 'https://www.dreamteamph.com', referer: 'https://www.dreamteamph.com/main' },
      body: JSON.stringify({ userId })
    });
    const body = await res.json().catch(() => ({}));
    if (body?.success) {
      const day = body.data?.progress?.currentDay ?? '?';
      this._log(account, 'success', 'dr.signIn600', { day }, `600-Day Sign In done · day ${day}`);
      return 'signed';
    }
    if (/already/i.test(reasonOf(body))) {
      this._log(account, 'info', 'dr.signIn600Already', {}, '600-Day Sign In was already done today');
      return 'already';
    }
    throw new Error(`${reasonOf(body)} (HTTP ${res.status})`);
  }

  async _dailyTasks(main, userId, signal) {
    const reply = await main.ack('getDailyTasks', { userId }, { signal });
    return reply || {};
  }

  async _startTasks(account, main, userId, signal) {
    this._step(account, 'tasks');
    const current = await this._dailyTasks(main, userId, signal);
    if (!current.needsStart) {
      this._log(account, 'info', 'dr.tasksAlready', {}, 'Daily tasks were already started');
      return 'already';
    }
    const reply = await main.ack('startDailyTasks', { userId }, { signal });
    if (!Array.isArray(reply?.tasks)) throw new Error(reasonOf(reply));
    this._log(account, 'success', 'dr.tasksStarted', { count: reply.tasks.length }, `Daily tasks started · ${reply.tasks.length} tasks`);
    return 'started';
  }

  async _taskDone(main, userId, key, signal) {
    const { tasks } = await this._dailyTasks(main, userId, signal);
    return Boolean(tasks?.find(x => x.task?.key === key)?.completed);
  }

  async _list(sim, userId, signal) {
    const list = await sim.ack('requestMatchList', { userId, tab: { type: 'FM' } }, { signal });
    if (!list?.success) throw new Error(`Match list: ${reasonOf(list)}`);
    return list;
  }

  // Join an open match without a password; if there is none (or every open one
  // is locked) create one and wait for an opponent. Resolves after the match ends.
  async _friendlyMatch(account, sim, main, userId, signal) {
    const { pollMs, busyWaitMs, opponentWaitMs, totalMs } = this.timing;
    const deadline = this.now() + totalMs;

    // A Quick Play match from before must end first; the game allows one match.
    const busyUntil = this.now() + busyWaitMs;
    for (;;) {
      const active = (await sim.ack('getUserActiveMatch', { userId }, { signal }))?.match;
      if (active && isFmEntry(active)) return this._waitMatchEnd(account, sim, main, userId, active, signal);
      if (!active) break;
      if (this.now() > busyUntil) throw new Error('Another match is still running.');
      this._step(account, 'fmBusy');
      await sleep(pollMs, signal);
    }

    while (this.now() < deadline) {
      const list = await this._list(sim, userId, signal);
      if (list.myActive) return this._waitMatchEnd(account, sim, main, userId, list.myActive, signal);

      let own = list.myPending?.match_id || null;
      if (!own) {
        this._step(account, 'fmSearching');
        const open = (list.matches || []).filter(m => isFmEntry(m) && m.status === 'waiting' && !m.opponent && m.host !== userId);
        const joinable = open.filter(m => !m.hasPassword);
        for (const m of joinable) {
          const r = await sim.ack('joinFM', { userId, matchId: m.match_id }, { signal });
          if (r?.success) {
            this._log(account, 'success', 'dr.fmJoined', { host: m.hostName || '?' }, `Friendly Match joined · host ${m.hostName || '?'}`);
            return this._waitMatchEnd(account, sim, main, userId, m, signal);
          }
          this._log(account, 'warning', 'dr.fmJoinFailed', { host: m.hostName || '?', error: reasonOf(r) }, `Could not join ${m.hostName || '?'}: ${reasonOf(r)}`);
        }
        // Not cut short by a stop: a match created meanwhile must still be cancelled.
        const r = await sim.ack('createFM', { userId, password: '' });
        if (!r?.success && /match|progress|already|active/i.test(reasonOf(r)) && this.now() + this.timing.busyRetryMs < deadline) {
          // Most likely a Quick Play match still running: wait and look again.
          this._log(account, 'info', 'dr.fmCreateWait', { error: reasonOf(r) }, `Could not create a match yet (${reasonOf(r)}); trying again in 30 s`);
          this._step(account, 'fmBusy');
          await sleep(this.timing.busyRetryMs, signal);
          continue;
        }
        if (!r?.success) throw new Error(`Create match: ${reasonOf(r)}`);
        own = r.matchId;
        if (signal?.aborted) {
          await sim.ack('cancelMatch', { userId, matchId: own }, { timeoutMs: 5000 }).catch(() => {});
          throw abortError();
        }
        this._log(account, 'info', 'dr.fmCreated', { locked: open.length - joinable.length }, `No joinable match (${open.length - joinable.length} with password) · created a Friendly Match`);
      }

      const started = await this._waitOpponent(account, sim, userId, own, Math.min(opponentWaitMs, deadline - this.now()), signal);
      if (started) return this._waitMatchEnd(account, sim, main, userId, started, signal);
      await sim.ack('cancelMatch', { userId, matchId: own }).catch(() => {});
      this._log(account, 'warning', 'dr.fmNoOpponent', { minutes: Math.round(opponentWaitMs / 60000) }, 'Nobody joined; the match was cancelled, looking again');
    }
    throw new Error('No Friendly Match could be played in time.');
  }

  async _waitOpponent(account, sim, userId, matchId, waitMs, signal) {
    const until = this.now() + Math.max(0, waitMs);
    try {
      while (this.now() < until) {
        this._step(account, 'fmWaitingOpponent', { until: new Date(until).toISOString() });
        await sleep(this.timing.pollMs, signal);
        const list = await this._list(sim, userId, signal);
        if (list.myActive) return list.myActive;
        if (!list.myPending) {
          // Started and already over, or removed by the game: check the task below.
          return { match_id: matchId };
        }
      }
      return null;
    } catch (error) {
      // Stopping Auto Play must not leave our open match behind.
      if (error?.name === 'AbortError') await sim.ack('cancelMatch', { userId, matchId }, { timeoutMs: 5000 }).catch(() => {});
      throw error;
    }
  }

  async _waitMatchEnd(account, sim, main, userId, match, signal) {
    const until = this.now() + this.timing.matchWaitMs;
    const opponent = match.opponentName || match.hostName || '';
    this._step(account, 'fmPlaying', { opponent });
    // Right after a join the game can still show no active match for a while, so
    // "no match" only means "ended" once the match was seen running. The daily
    // task turning complete is what counts.
    const appearBy = this.now() + this.timing.appearMs;
    let seen = false;
    let goneChecks = 0;
    while (this.now() < until) {
      if (await this._taskDone(main, userId, 'friendly_match', signal)) {
        this._log(account, 'success', 'dr.fmDone', {}, 'Friendly Match finished · daily task complete');
        return 'played';
      }
      const active = (await sim.ack('getUserActiveMatch', { userId }, { signal }))?.match;
      if (active) { seen = true; goneChecks = 0; }
      else if (seen || this.now() > appearBy) {
        // Ended (or never started): the task counter can lag a moment behind.
        if (++goneChecks > 5) {
          throw new Error(seen ? 'The match ended but the Friendly Match task is not complete.' : 'The match never started.');
        }
      }
      await sleep(this.timing.pollMs, signal);
    }
    throw new Error('The Friendly Match did not end in time.');
  }
}

module.exports = { DailyRoutineService, isFmEntry };
