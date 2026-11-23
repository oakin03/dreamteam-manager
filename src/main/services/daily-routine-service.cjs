const { GameSocket } = require('./game-socket.cjs');
const { handleInjury, InjuredError, injuryBlocked } = require('./injury-guard.cjs');
const { WIDE, eachAtOnce, eachWithSocket } = require('./wide.cjs');
// The routine's day turns at 19:10 TR (16:10 UTC); it runs at 19:12. Its own copy: the market's listing
// expiry moved to the real 19:05 (2026-11-17) and the saved cycle keys stay on 16:10 (DAY_MS below).
function lastExpiryCutoff(now = Date.now()) {
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 16, 10);
  return today <= now ? today : today - DAY_MS;
}

// Once per game day (after the 19:10 TR reset) Auto Play first runs the daily
// routine for the selected accounts: Daily Signin, 600-Day Sign In, starting
// the daily tasks, one Friendly Match and one Group Match. Everything goes through the game's
// socket / HTTP API; every step is safe to repeat ("already done" answers).
const SIGNIN_600_URL = 'https://www.dreamteamph.com/api/daily-signin-600';
const DEFAULT_TIMING = {
  pollMs: 3000,
  busyWaitMs: 10 * 60 * 1000,     // a Quick Play match still running from before
  busyRetryMs: 30 * 1000,         // "create match" refused while that match runs
  opponentWaitMs: 10 * 60 * 1000, // nobody joined our match → cancel and look again
  matchWaitMs: 20 * 60 * 1000,    // one Friendly Match takes a few minutes
  appearMs: 90 * 1000,            // a joined match must show up as active by then
  totalMs: 40 * 60 * 1000,        // after this Auto Play goes on; the next start retries
  partyWaitMs: 10 * 60 * 1000,    // Group Match: a party that is not matched by then is left
  unreadyKickMs: 60 * 1000,       // our full party: a member not ready this long is kicked (leader)
  idleLeaderMs: 60 * 1000,        // a stranger's full, ready party whose leader does not search: leave
  leaveWaitMs: 10 * 60 * 1000,    // the party cannot be left while its games run: wait this long
  groupTotalMs: 40 * 60 * 1000,
  // Group Match helpers (user 2026-11-23): instead of giving up, accounts whose Auto Play runs
  // fill our party, and if no opponent party comes, 3 more form one.
  helperAfterMs: 2 * 60 * 1000,   // our party still not full this long -> 1-2 helpers join it
  opponentAfterMs: 2 * 60 * 1000, // our full party searching this long without a match -> 3 helpers form an opponent party
  helperMaxMs: 20 * 60 * 1000,    // a helper goes back to Auto Play after this at the latest
  helperBusyMs: 6 * 60 * 1000,    // a helper's Quick Play match from before the hold: wait this long
  helperGraceMs: 8 * 1000         // our party matched but the helpers' party not: not them -> break up
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_DELAY_MS = 2 * 60 * 1000;   // runs at 19:12 TR, after the game's reset settles
const RETRY_MS = 30 * 60 * 1000;      // an incomplete routine is tried again after this
const RECHECK_MS = 60 * 60 * 1000;    // and the schedule is looked at again at least hourly
// while Auto Play runs, finished task rewards are claimed this often (was 30 min: the PK tasks
// finished between two checks sat unclaimed for up to half an hour, user 2026-11-23)
const REWARD_CHECK_MS = 10 * 60 * 1000;
const DONATION_TK = 100;                // daily alliance donation (the game's minimum)

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

// "3 Energy Drink, 2 Gift Box" from the items of the claimed mails (the shape varies
// between mail kinds: {itemDetail:{name}, metadata:{name}, quantity} as seen live, or older
// {name, quantity} / {item:{name}, amount}).
function mailItems(mails) {
  const totals = new Map();
  for (const mail of mails) for (const it of mail.items || []) {
    const name = it?.itemDetail?.name || it?.metadata?.name || it?.item?.name || it?.itemName || it?.name || it?.itemType;
    if (!name) continue;
    totals.set(name, (totals.get(name) || 0) + (Number(it.quantity ?? it.amount) || 1));
  }
  return [...totals].map(([name, n]) => `${n} ${name}`).join(', ');
}

const isFmEntry = m => m?.type === 'FM' || /^fm-/.test(String(m?.match_id || ''));
const reasonOf = r => String(r?.error || r?.message || 'rejected');
const CAP_RE = /salary cap/i;

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
    this.helpers = null;             // { idle(): [{accountId, message}], hold(accountId, fn) } from the task engine
    this.helping = new Set();        // accountIds helping a Group Match right now
    this.helperRuns = [];            // their promises (tests wait for them)
  }

  // The task engine lends accounts whose Auto Play runs (main.cjs).
  setHelpers(helpers) { this.helpers = helpers; }

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
      await this._leaveStaleParty(account, signal).catch(error => { if (error?.name === 'AbortError') throw error; });
      await this._donateLate(account, signal);
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
        ['donate', () => this._donate(account, userId, cycle, signal)],
        ['friendly', async () => {
          if (await this._taskDone(main, userId, 'friendly_match', signal)) return 'already';
          if (injuryBlocked(account.id)) throw new InjuredError('An injured starter blocks the match (Bag → Anesthesia)');
          sim = await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/', cookie, signal });
          return this._friendlyMatch(account, sim, main, userId, signal);
        }],
        // Group Match (3v3 parties, game update 2026-11): after the Friendly Match
        ['group', async () => {
          sim ||= await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/', cookie, signal });
          // done already: an account still sitting in a party (an earlier run was stopped) leaves it
          if (await this._taskDone(main, userId, 'group_match', signal)) { await this._leaveParty(account, sim, userId).catch(() => {}); return 'already'; }
          // No opponent party was found earlier today: don't keep retrying (and spamming the error)
          // at every routine check — leave Group Match for the next day. (user 2026-11-21)
          if ((this._saved(account.id) || {}).groupGaveUpCycle === cycle) { await this._leaveParty(account, sim, userId).catch(() => {}); return 'noOpponent'; }
          if (injuryBlocked(account.id)) throw new InjuredError('An injured starter blocks the match (Bag → Anesthesia)');
          const r = await this._groupMatch(account, sim, main, userId, signal);
          if (r === 'noOpponent') this._save(account.id, { ...(this._saved(account.id) || {}), groupGaveUpCycle: cycle });
          return r;
        }]
      ];
      for (const [key, run] of steps) {
        try {
          results[key] = await run();
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          results[key] = 'failed';
          failed.push(key);
          this._log(account, error?.injured ? 'warning' : 'error', `dr.${key}Failed`, { error: error.message }, `Daily routine · ${key} failed: ${error.message}`);
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
      this._save(account.id, { rewards: keep.rewards, tasks: keep.tasks, donation: keep.donation, donateChecked: keep.donateChecked, cycle, doneAt: new Date(this.now()).toISOString(), results, partyLeftCycle: cycle });
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
    await eachAtOnce(accounts, async account => { out[account.id] = await this._claimSafely(account, null); });
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
    const sum = await this._claimTasks(account, main, userId, signal);
    // Mail rewards (event gifts, compensation) ride along every task-reward check.
    try { await this._claimMail(account, main, userId, signal); } catch (error) {
      if (error?.name === 'AbortError') throw error;
      this._log(account, 'warning', 'ml.failed', { error: error.message }, `Mail rewards could not be claimed: ${error.message}`);
    }
    return sum;
  }

  // Mail box (captured from the game client 2026-10-25, /socket/, acks, cookie only):
  //   getUserMails {userId} -> {success, mails:[{id, title, isRead, isClaimed, items:[...]}]}
  //   claimMailItems {mailId} -> {success, message}  (one by one: the game removed claimAllMailItems 2026-11-05)
  async _claimMail(account, main, userId, signal) {
    const box = await main.ack('getUserMails', { userId }, { signal });
    if (!box?.success) throw new Error(reasonOf(box));
    const open = (box.mails || []).filter(m => !m.isClaimed && Array.isArray(m.items) && m.items.length);
    if (!open.length) return { count: 0 };
    const done = [];
    let lastError = null;
    for (const m of open) {
      const reply = await this._claimAck(main, 'claimMailItems', { mailId: m.id }, signal);
      if (reply?.success) done.push(m); else lastError = reasonOf(reply);
    }
    if (!done.length) throw new Error(lastError || 'mail rewards refused');
    const items = mailItems(done);
    this._log(account, 'success', 'ml.claimed', { count: done.length, items: items || '—' }, `Mail rewards claimed · ${done.length} mail(s)${items ? ` · ${items}` : ''}`);
    return { count: done.length, items };
  }

  async _claimTasks(account, main, userId, signal) {
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

  // 100 TK to the alliance once a game day (user 2026-10-30), only for accounts in an
  // alliance and with the TK. The game counts only the first donation of a day, so a
  // routine retried later the same day does not give again.
  async _donate(account, userId, cycle, signal) {
    if (this._saved(account.id)?.donation?.cycle === cycle) return 'already';
    this._step(account, 'donate');
    // The alliance events read the account from a registered socket (no userId in them);
    // unregistered the game answers a bare {success:false} (seen live 2026-10-30). That
    // socket is opened only here and closed at once, so the routine's own one stays
    // unregistered. `donateChecked` marks a day whose answer is final.
    // a connection another service already registered for the account is used as it is:
    // registering again would sign that service out
    const borrowed = GameSocket.borrow?.(userId) || null;
    let reg = borrowed;
    if (!reg) {
      const { cookieHeader: cookie } = await this.sessions.get(account, { owner: 'daily-routine' });
      reg = await GameSocket.open({ createSocket: this.createSocket, cookie, signal });
    }
    try {
      if (!borrowed) await reg.register(userId, { signal, owner: 'Daily routine' });
      const info = await reg.ack('alliance:getInfo', {}, { signal });
      if (!info?.success || !info.data?.name) {
        this._log(account, 'info', 'dr.donateNoAlliance', {}, 'Not in an alliance · no donation');
        this._markDonate(account.id, cycle);
        return 'noAlliance';
      }
      const basic = await reg.call('getUserBasicInfo', { userId }, 'userBasicInfo', { signal, timeoutMs: 10000 }).catch(() => null);
      const funds = Number(basic?.funds);
      if (Number.isFinite(funds) && funds < DONATION_TK) {
        this._log(account, 'warning', 'dr.donateNoFunds', { tk: funds, amount: DONATION_TK }, `Not enough TK for the alliance donation (${funds} / ${DONATION_TK})`);
        this._markDonate(account.id, cycle);
        return 'noFunds';
      }
      const r = await this._claimAck(reg, 'alliance:donate', { amount: DONATION_TK }, signal);
      if (!r?.success) {
        const why = reasonOf(r);
        // a new member must wait a day: not an error, tomorrow it works
        if (/new member|wait 1 day|must wait/i.test(why)) {
          this._log(account, 'info', 'dr.donateNewMember', {}, 'New alliance member · donations open after one day');
          this._markDonate(account.id, cycle);
          return 'newMember';
        }
        throw new Error(why);
      }
      this._save(account.id, { ...(this._saved(account.id) || {}), donation: { cycle, at: new Date(this.now()).toISOString(), amount: DONATION_TK }, donateChecked: cycle });
      this._log(account, 'success', 'dr.donated', { amount: DONATION_TK, alliance: info.data.name || '' }, `${DONATION_TK} TK donated to the alliance${info.data.name ? ` ${info.data.name}` : ''}`);
      return 'donated';
    } finally { if (!borrowed) { try { reg.close(); } catch {} } }
  }

  _markDonate(accountId, cycle) { this._save(accountId, { ...(this._saved(accountId) || {}), donateChecked: cycle }); }

  // A routine already done today whose donation was never answered for good (e.g. the
  // early version that read every account as "not in an alliance"): donate now.
  async _donateLate(account, signal) {
    const cycle = this.cycle();
    const saved = this._saved(account.id);
    if (saved?.donateChecked === cycle || saved?.donation?.cycle === cycle) return;
    try {
      const { userId } = await this.sessions.get(account, { owner: 'daily-routine' });
      await this._donate(account, userId, cycle, signal);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      this._log(account, 'error', 'dr.donateFailed', { error: error.message }, `Alliance donation failed: ${error.message}`);
      this._markDonate(account.id, cycle);
    } finally {
      this.live.delete(account.id);
      this.onChanged?.();
    }
  }

  async _signIn(account, main, userId, signal) {
    this._step(account, 'signIn');
    // A new account has no streak yet: the game answers "signInStatus" {started:false}
    // (no "dailySignIn:data") until "Start my streak" (startDailySignIn) is pressed.
    const SIGNIN_EVENTS = ['dailySignIn:data', 'signInStatus'];
    let status = (await this._race(main, 'getSignInStatus', { userId }, SIGNIN_EVENTS, signal)).data;
    if (status?.started === false) {
      const started = await this._race(main, 'startDailySignIn', { userId }, [...SIGNIN_EVENTS, 'dailySignIn:error', 'signInError'], signal);
      if (/error/i.test(started.event)) throw new Error(String(started.data?.message || started.data || 'Daily Signin could not be started'));
      this._log(account, 'success', 'dr.signInStarted', {}, 'Daily Signin streak started');
      status = started.data?.started === false ? status : started.data;
    }
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
          // an injured starter: no other match can be joined either (33 000 refusals on 2026-11-18)
          const inj = r?.success ? null : await handleInjury(account.id, reasonOf(r), 'Friendly Match');
          if (inj === false) throw new InjuredError(reasonOf(r));
          if (inj === true) break;
          if (r?.success) {
            this._log(account, 'success', 'dr.fmJoined', { host: m.hostName || '?' }, `Friendly Match joined · host ${m.hostName || '?'}`);
            return this._waitMatchEnd(account, sim, main, userId, m, signal);
          }
          this._log(account, 'warning', 'dr.fmJoinFailed', { host: m.hostName || '?', error: reasonOf(r) }, `Could not join ${m.hostName || '?'}: ${reasonOf(r)}`);
        }
        // Not cut short by a stop: a match created meanwhile must still be cancelled.
        const r = await sim.ack('createFM', { userId, password: '' });
        const injC = r?.success ? null : await handleInjury(account.id, reasonOf(r), 'Friendly Match');
        if (injC === false) throw new InjuredError(reasonOf(r));
        if (injC === true) continue;
        if (!r?.success && /in progress|already|active match|in a match/i.test(reasonOf(r)) && this.now() + this.timing.busyRetryMs < deadline) {
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

  // userIds of our own accounts: their parties are joined first
  _ourUserIds() {
    const prof = this.store.getAccountProfile?.()?.accounts || {};
    return new Set(Object.values(prof).map(p => p?.userId).filter(Boolean));
  }

  async _myParty(sim, userId, signal) {
    const r = await sim.ack('getMyParty', { userId }, { signal });
    if (!r?.success) throw new Error(`My party: ${reasonOf(r)}`);
    return r.party || null;
  }

  // Group Match: parties of 3; everyone presses Ready, the leader presses Find match when the
  // party is full, and it is matched with another full party (no bots). Join an open party
  // without a password (ours first: a party with one of our accounts in it; fuller ones
  // first), else create one. A party not matched in partyWaitMs is left and the search starts
  // again. Done when the group_match task completes; the party is then left, because an
  // account in a party cannot play Quick Play.
  async _groupMatch(account, sim, main, userId, signal) {
    const { pollMs, partyWaitMs, groupTotalMs } = this.timing;
    const deadline = this.now() + groupTotalMs;
    const ours = this._ourUserIds();
    const tried = new Set();
    let party = await this._myParty(sim, userId, signal);
    try {
      while (this.now() < deadline) {
        if (!party) {
          this._step(account, 'gmSearching');
          const list = await sim.ack('requestPartyList', undefined, { signal });
          if (!list?.success) throw new Error(`Party list: ${reasonOf(list)}`);
          // Only parties led by one of our accounts are joined (user 2026-11-09: strangers' parties
          // bring problems we cannot control: away leaders, members who never get ready). Others
          // may join ours. No party of ours open: we make one.
          const ourLead = p => ours.has(p.leader) && p.leader !== userId;
          const open = (list.parties || []).filter(p => (p.mode || 'GROUP') === 'GROUP' && p.status === 'open' && !p.hasPassword && ourLead(p) && (p.members || []).length < (p.maxMembers || 3) && !(p.members || []).some(m => m.userId === userId) && !tried.has(p.party_id));
          open.sort((a, b) => ((b.members || []).length - (a.members || []).length) || ((a.createdAt || 0) - (b.createdAt || 0)));
          for (const p of open) {
            tried.add(p.party_id);
            const r = await sim.ack('joinParty', { userId, partyId: p.party_id }, { signal });
            if (r?.success) {
              party = r.party || await this._myParty(sim, userId, signal);
              this._log(account, 'success', 'dr.gmJoined', { leader: p.leaderName || '?' }, `Group Match party joined · leader ${p.leaderName || '?'}`);
              break;
            }
            // over the salary cap: every party (and our own) says the same, stop here
            if (CAP_RE.test(reasonOf(r))) throw new Error(reasonOf(r));
            this._log(account, 'warning', 'dr.gmJoinFailed', { leader: p.leaderName || '?', error: reasonOf(r) }, `Could not join the party of ${p.leaderName || '?'}: ${reasonOf(r)}`);
          }
          if (!party) {
            // not cut short by a stop: a party created meanwhile must still be left
            const r = await sim.ack('createParty', { userId });
            if (!r?.success) throw new Error(`Create party: ${reasonOf(r)}`);
            party = r.party || await this._myParty(sim, userId, signal);
            this._log(account, 'info', 'dr.gmCreated', {}, 'No joinable party · created a Group Match party');
            if (signal?.aborted) throw abortError();
          }
        }
        // in the party: ready up, the leader finds the match, wait for the games
        let joinedAt = this.now();
        let matched = false;
        let searchingSince = null;
        // what the helpers see of this party (status) and whether help was already sent for it
        const help = { partyId: party.party_id, requester: userId, status: party.status, over: false, filled: false, opponent: false };
        let unreadySince = null;
        let idleSince = null;
        while (party && this.now() < deadline) {
          if (await this._taskDone(main, userId, 'group_match', signal)) {
            help.over = true;
            this._log(account, 'success', 'dr.gmDone', {}, 'Group Match finished · daily task complete');
            return 'played';
          }
          const members = party.members || [];
          const me = members.find(m => m.userId === userId);
          const full = members.length >= (party.maxMembers || 3);
          help.status = party.status;
          if (party.status === 'matched') {
            if (!matched) this._log(account, 'info', 'dr.gmMatched', {}, 'Group Match found · the games are being played');
            matched = true;
            this._step(account, 'gmPlaying');
          } else if (party.status === 'searching') {
            this._step(account, 'gmSearchingMatch');
            searchingSince ??= this.now();
            // nobody to play against: 3 of our Auto Play accounts form the opponent party
            if (!help.opponent && this.now() - searchingSince >= this.timing.opponentAfterMs) {
              help.opponent = true;
              if (this._sendOpponents(account, help)) joinedAt = this.now();
            }
          } else {
            searchingSince = null;
            // our party stays short: Auto Play accounts of ours fill it
            if (!help.filled && !full && this.now() - joinedAt >= this.timing.helperAfterMs) {
              help.filled = true;
              if (this._sendFillers(account, help, (party.maxMembers || 3) - members.length)) joinedAt = this.now();
            }
            if (me && !me.ready) await sim.ack('setPartyReady', { userId, ready: true }, { signal }).catch(() => null);
            const unready = members.filter(m => !m.ready && m.userId !== userId);
            if (party.leader === userId && full && !unready.length) {
              unreadySince = null;
              const r = await sim.ack('findPartyMatch', { userId }, { signal });
              if (r?.success) this._log(account, 'info', 'dr.gmFind', {}, 'Party full · looking for an opponent party');
              else {
                this._log(account, 'warning', 'dr.gmFindFailed', { error: reasonOf(r) }, `Find match failed: ${reasonOf(r)}`);
                // a member over the salary cap blocks the party: put that one out
                const name = (reasonOf(r).match(/^(.+?) is over the salary cap/i) || [])[1];
                const bad = name && members.find(m => m.userId !== userId && m.teamName === name);
                if (bad) await sim.ack('kickPartyMember', { userId, targetId: bad.userId }, { signal }).catch(() => null);
              }
            } else if (party.leader === userId && full && unready.length) {
              // full but someone does not press Ready: after a minute that one is put out, so
              // another account can take the place (user 2026-11-09)
              unreadySince ??= this.now();
              if (this.now() - unreadySince >= this.timing.unreadyKickMs) {
                for (const m of unready) {
                  const r = await sim.ack('kickPartyMember', { userId, targetId: m.userId }, { signal }).catch(() => null);
                  if (r?.success) this._log(account, 'info', 'dr.gmKicked', { name: m.teamName || '?' }, `${m.teamName || '?'} did not get ready · put out of the party`);
                }
                unreadySince = null;
              }
            } else unreadySince = null;
            // someone else leads a full, ready party and does not search: leave it
            if (party.leader !== userId && full && !members.some(m => !m.ready)) {
              idleSince ??= this.now();
              if (this.now() - idleSince >= this.timing.idleLeaderMs) {
                tried.add(party.party_id);
                await sim.ack('leaveParty', { userId }, { signal }).catch(() => null);
                const leader = members.find(m => m.userId === party.leader)?.teamName || party.leaderName || '?';
                this._log(account, 'warning', 'dr.gmLeaderIdle', { leader }, `${leader} does not start the match · left the party, looking for another`);
                party = null;
                break;
              }
            } else idleSince = null;
            this._step(account, 'gmWaitingParty', { count: members.length, max: party.maxMembers || 3 });
            if (!matched && this.now() - joinedAt > partyWaitMs) {
              await sim.ack('leaveParty', { userId }, { signal }).catch(() => null);
              this._log(account, 'warning', 'dr.gmNoMatch', { minutes: Math.round(partyWaitMs / 60000) }, 'The party was not matched in time · left it, looking again');
              party = null;
              break;
            }
          }
          await sleep(pollMs, signal);
          party = await this._myParty(sim, userId, signal);
          // put out of the party by its leader: look for another one
          if (!party && !matched) this._log(account, 'warning', 'dr.gmRemoved', {}, 'Removed from the party · looking for another one');
          if (!party || party.party_id !== help.partyId) help.over = true;
        }
        help.over = true;
      }
      // No opponent party showed up (3v3 needs a second full party; our own accounts rarely get
      // paired by the game's public matchmaking). This is not a fault of the account — give up for
      // today instead of failing the routine and retrying every 30 min. (user 2026-11-21)
      this._log(account, 'warning', 'dr.gmGaveUp', {}, 'No opponent party found in time · Group Match left for the next day');
      return 'noOpponent';
    } finally {
      await this._leaveParty(account, sim, userId);
    }
  }

  // ---- Group Match helpers (user 2026-11-23) ----
  // Accounts whose Auto Play runs lend a hand: their Quick Play waits (task engine hold) while
  // they fill our party or form the opponent party, then goes on. Main / second main are never
  // used; accounts that only wait for the daily PK reset come first; injured ones never.
  _pickHelpers(n, exclude = []) {
    if (!this.helpers || n <= 0) return [];
    const prof = this.store.getAccountProfile?.() || {};
    const skip = new Set([prof.mainAccountId, prof.secondMainId, ...exclude, ...this.helping].filter(Boolean));
    const users = prof.accounts || {};
    const byId = new Map((this.store.getAccounts?.() || []).map(a => [a.id, a]));
    const pool = (this.helpers.idle() || []).filter(h => byId.has(h.accountId) && !skip.has(h.accountId) && users[h.accountId]?.userId
      && !this.live.has(h.accountId) && !injuryBlocked(h.accountId));
    pool.sort((a, b) => Number(/pk limit/i.test(b.message)) - Number(/pk limit/i.test(a.message)));
    return pool.slice(0, n).map(h => byId.get(h.accountId));
  }

  _lend(helper, fn) {
    this.helping.add(helper.id);
    const run = this.helpers.hold(helper.id, signal => fn(signal));
    if (!run) { this.helping.delete(helper.id); return false; }
    const done = Promise.resolve(run).finally(() => this.helping.delete(helper.id));
    this.helperRuns.push(done);
    return true;
  }

  // 1-2 helpers join our party that stays short.
  _sendFillers(account, help, count) {
    const helpers = this._pickHelpers(count, [account.id]);
    if (!helpers.length) return false;
    const sent = helpers.filter(h => this._lend(h, signal => this._helpParty(h, { help, partyId: help.partyId }, signal)));
    if (!sent.length) return false;
    const names = sent.map(h => h.name).join(', ');
    this._log(account, 'info', 'dr.gmHelpers', { names }, `The party stays short · ${names} join it (their Auto Play waits meanwhile)`);
    return true;
  }

  // 3 helpers form the opponent party: the first creates it, the other two join it.
  _sendOpponents(account, help) {
    const helpers = this._pickHelpers(3, [account.id]);
    if (helpers.length < 3) {
      this._log(account, 'warning', 'dr.gmNoHelpers', {}, 'No opponent party and not enough free Auto Play accounts to form one');
      return false;
    }
    let created; const partyReady = new Promise(resolve => { created = resolve; });
    const [lead, ...rest] = helpers;
    if (!this._lend(lead, signal => this._helpParty(lead, { help, lead: true, onCreated: created }, signal))) return false;
    for (const h of rest) this._lend(h, signal => this._helpParty(h, { help, partyReady }, signal));
    const names = helpers.map(h => h.name).join(', ');
    this._log(account, 'info', 'dr.gmOpponents', { names }, `No opponent party · ${names} form one (their Auto Play waits meanwhile)`);
    return true;
  }

  // One helper's part. Filling (partyId): join our party, ready up, play, leave. Opponent
  // (lead / partyReady): be in the second party; it searches when full and ready. If OUR party is
  // matched while this one is not, it was matched with someone else: the second party breaks up
  // at once (user 2026-11-23). Our party gone / its account done: the helpers leave too.
  async _helpParty(helper, { help, partyId = null, lead = false, onCreated = null, partyReady = null }, signal) {
    const t = this.timing;
    const until = this.now() + t.helperMaxMs;
    const opponent = Boolean(lead || partyReady);
    let sim = null; let userId = null; let joined = false;
    try {
      const session = await this.sessions.get(helper, { owner: 'daily-routine' });
      userId = session.userId;
      sim = await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/', cookie: session.cookieHeader, signal });
      // a Quick Play match started before the hold: let it end first
      const busyUntil = this.now() + t.helperBusyMs;
      while ((await sim.ack('getUserActiveMatch', { userId }, { signal }).catch(() => null))?.match) {
        if (this.now() >= busyUntil || help.over) { onCreated?.(null); return 'busy'; }
        await sleep(t.pollMs, signal);
      }
      if (help.over) { onCreated?.(null); return 'over'; }
      if (lead) {
        const r = await sim.ack('createParty', { userId }, { signal });
        if (!r?.success) { onCreated?.(null); this._log(helper, 'warning', 'dr.gmHelpFailed', { error: reasonOf(r) }, `Group Match help: ${reasonOf(r)}`); return 'failed'; }
        partyId = (r.party || await this._myParty(sim, userId, signal))?.party_id;
        onCreated?.(partyId);
      } else {
        if (partyReady) partyId = await partyReady;
        if (!partyId || help.over) return 'over';
        const r = await sim.ack('joinParty', { userId, partyId }, { signal });
        if (!r?.success) { this._log(helper, 'warning', 'dr.gmHelpFailed', { error: reasonOf(r) }, `Group Match help: ${reasonOf(r)}`); return 'failed'; }
      }
      joined = true;
      this._log(helper, 'info', 'dr.gmHelping', {}, 'Helping a Group Match · Auto Play waits meanwhile');
      let matched = false; let otherMatchedAt = null;
      while (this.now() < until) {
        const party = await this._myParty(sim, userId, signal);
        if (!party) break;
        if (party.status === 'matched') matched = true;
        else if (matched) break; // the games are over (the party opened again)
        else {
          const members = party.members || [];
          const me = members.find(m => m.userId === userId);
          if (me && !me.ready) await sim.ack('setPartyReady', { userId, ready: true }, { signal }).catch(() => null);
          const full = members.length >= (party.maxMembers || 3);
          if (opponent) {
            // our party found its match elsewhere (or is done): this party is not needed any more
            if (help.status === 'matched') otherMatchedAt ??= this.now(); else otherMatchedAt = null;
            if (help.over || (otherMatchedAt != null && this.now() - otherMatchedAt >= t.helperGraceMs)) {
              this._log(helper, 'info', 'dr.gmHelpDisband', {}, 'Our party was matched with another party · the helper party breaks up');
              break;
            }
            if (lead && party.status === 'open' && full && members.every(m => m.ready || m.userId === userId)) {
              await sim.ack('findPartyMatch', { userId }, { signal }).catch(() => null);
            }
          } else if (help.over || !members.some(m => m.userId === help.requester)) break; // the account we help left
        }
        await sleep(t.pollMs, signal);
      }
      return matched ? 'played' : 'left';
    } catch (error) {
      if (!joined) onCreated?.(null);
      if (error?.name !== 'AbortError') this._log(helper, 'warning', 'dr.gmHelpFailed', { error: error.message }, `Group Match help: ${error.message}`);
      return 'error';
    } finally {
      if (sim && userId) {
        const p = await this._myParty(sim, userId, null).catch(() => null);
        if (p) await this._leaveParty(helper, sim, userId).catch(() => {});
        try { sim.close(); } catch {}
      }
    }
  }

  // An account in a party cannot play Quick Play: always leave. Nobody can leave while the games
  // are played (status 'matched'), so wait for them first (2026-11-09: leaders and members were
  // left in their reopened parties after the match).
  async _leaveParty(account, sim, userId) {
    const until = this.now() + this.timing.leaveWaitMs;
    let p = await this._myParty(sim, userId, null).catch(() => null);
    while (p && p.status === 'matched' && this.now() < until) {
      this._step(account, 'gmLeaving');
      await sleep(this.timing.pollMs);
      p = await this._myParty(sim, userId, null).catch(() => null);
    }
    if (!p) return false;
    if (p.status === 'searching') await sim.ack('cancelPartySearch', { userId }, { timeoutMs: 5000 }).catch(() => null);
    const r = await sim.ack('leaveParty', { userId }, { timeoutMs: 5000 }).catch(() => null);
    if (r?.success !== false) this._log(account, 'info', 'dr.gmLeft', {}, 'Left the Group Match party');
    return true;
  }

  // Accounts left in a party by an earlier run (before 2026-11-09): out, so Quick Play works.
  async _leaveStaleParty(account, signal) {
    const saved = this._saved(account.id);
    if (!['played', 'already'].includes(saved?.results?.group) || saved.partyLeftCycle === this.cycle()) return;
    const { userId, cookieHeader: cookie } = await this.sessions.get(account, { owner: 'daily-routine' });
    const sim = await GameSocket.open({ createSocket: this.createSocket, path: '/simulation-socket/', cookie, signal });
    try {
      const p = await this._myParty(sim, userId, signal).catch(() => null);
      if (p && (p.mode || 'GROUP') === 'GROUP' && p.status !== 'matched') await this._leaveParty(account, sim, userId);
      if (!p || p.status !== 'matched') this._save(account.id, { ...(this._saved(account.id) || {}), partyLeftCycle: this.cycle() });
    } finally { try { sim.close(); } catch {} }
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

module.exports = { DailyRoutineService, isFmEntry, mailItems };
