const { GameSocket } = require('./game-socket.cjs');

// Daily Rewards (the Stadium gift, 6 tiers a day with a timer between them) are
// collected over the game socket while Auto Play runs for an account:
//   dailyRewards:getProgress {userId} → dailyRewards:progressResult
//     { success, data: { currentTier, isComplete, isReadyToClaim, timeUntilClaim,
//       claimedCount, totalTiers, nextClaimTime, currentTierRewards } }
//   dailyRewards:claim {userId} → dailyRewards:claimResult
//     { success, data: { rewards, currentTier, isComplete, nextClaimTime } } or
//     { success:false, error:'Rate limit…' | 'Please wait N seconds…', retryAfter }
// No browser and no `register`, so nothing else signed in is kicked.

const ERROR_RETRY_MS = 60 * 1000;
const SAFETY_MS = 1500; // claim a moment after the timer, the server clock may lag

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

function parseCountdown(value) {
  const text = String(value || '').trim();
  const m = text.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!m) return null;
  if (m[3] != null) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatCountdown(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function nextDailyResetAt(nowMs = Date.now()) {
  // DreamTeam's daily reset is Manila midnight (UTC+8), i.e. 19:00 in Türkiye.
  // Give the new day ten seconds to appear in the game before checking again.
  const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
  const shifted = new Date(nowMs + MANILA_OFFSET_MS);
  const nextMidnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    0, 0, 10, 0
  );
  return nextMidnightUtc - MANILA_OFFSET_MS;
}

// Milliseconds until the next tier can be claimed (0 = now), from a progress reply.
function waitMsOf(data, now = Date.now()) {
  if (data?.isReadyToClaim) return 0;
  const at = Date.parse(data?.nextClaimTime);
  if (Number.isFinite(at)) return Math.max(0, at - now);
  const left = Number(data?.timeUntilClaim);
  return Number.isFinite(left) ? Math.max(0, left) : null;
}

// "2 Energy Drink, 500 XP" from claim rewards [{type, amount, item:{name}}].
function rewardText(rewards) {
  return (Array.isArray(rewards) ? rewards : [])
    .map(r => `${Number(r?.amount) || 1} ${r?.item?.name || r?.itemName || r?.type || ''}`.trim())
    .filter(Boolean)
    .join(', ');
}

// Seconds the server asks us to wait after a refused claim, if it says so.
function retryAfterMs(reply) {
  if (Number(reply?.retryAfter) > 0) return Number(reply.retryAfter) * 1000;
  const m = String(reply?.error || '').match(/(\d+)\s*second/i);
  return m ? Number(m[1]) * 1000 : null;
}

class DailyRewardService {
  constructor({ store, activity, engine, sessions, createSocket, onChanged, now = () => Date.now() }) {
    this.store = store;
    this.activity = activity;
    this.engine = engine;
    this.sessions = sessions;
    this.createSocket = createSocket;
    this.onChanged = onChanged;
    this.now = now;
    this.states = new Map();
    this.workers = new Map();
    this.monitor = null;
    for (const [id, hold] of Object.entries(this.store.getDailyRewards()?.accounts || {})) {
      if (Date.parse(hold?.nextAt) > this.now()) this.showDailyHold(id, hold);
    }
  }

  snapshot() {
    const out = {};
    for (const [id, state] of this.states) out[id] = { ...state };
    return out;
  }

  accountById(id) {
    return this.store.getAccounts().find(a => a.id === id) || null;
  }

  log(account, level, code, params, message) {
    this.activity.add({ level, accountId: account.id, accountName: account.name, taskName: 'Daily Reward', code, params, message });
  }

  setState(accountId, patch) {
    const current = this.states.get(accountId) || { status: 'idle', timerText: null, nextAt: null, tier: null, lastClaimAt: null, error: null };
    this.states.set(accountId, { ...current, ...patch });
    this.onChanged?.();
  }

  dailyHold(accountId) {
    const hold = this.store.getDailyRewards()?.accounts?.[accountId];
    return Date.parse(hold?.nextAt) > this.now() ? hold : null;
  }

  showDailyHold(accountId, hold) {
    const status = hold.reason === 'completed' ? 'completed' : 'reset-wait';
    const current = this.states.get(accountId);
    if (current?.status === status && current.nextAt === hold.nextAt) return;
    this.setState(accountId, {
      status, tier: hold.tier || current?.tier || null, timerText: null,
      nextAt: hold.nextAt, error: null
    });
  }

  clearExpiredDailyHold(accountId) {
    const saved = this.store.getDailyRewards();
    if (!saved?.accounts?.[accountId] || this.dailyHold(accountId)) return;
    const accounts = { ...saved.accounts };
    delete accounts[accountId];
    this.store.saveDailyRewards({ ...saved, accounts });
  }

  holdUntilReset(account, reason, tier = null) {
    const existing = this.dailyHold(account.id);
    if (existing) {
      this.showDailyHold(account.id, existing);
      return { delayMs: Math.max(1000, Date.parse(existing.nextAt) - this.now()) };
    }
    const nextAt = new Date(nextDailyResetAt(this.now())).toISOString();
    const saved = this.store.getDailyRewards();
    const hold = { reason, tier, nextAt };
    this.store.saveDailyRewards({
      ...saved, version: 1, accounts: { ...(saved?.accounts || {}), [account.id]: hold }
    });
    this.showDailyHold(account.id, hold);
    if (reason === 'completed') this.log(account, 'success', 'dw.completed', {}, 'Daily Rewards completed for today (6/6).');
    return { delayMs: Math.max(1000, Date.parse(nextAt) - this.now()) };
  }

  start() {
    if (this.monitor) return;
    this.monitor = setInterval(() => this.sync().catch(() => {}), 2000);
    this.sync().catch(() => {});
  }

  // A worker runs for every account Auto Play is running.
  async sync() {
    const runtime = this.engine.states();
    const active = new Set(
      Object.entries(runtime)
        .filter(([, r]) => r?.status === 'running')
        .map(([id]) => id)
    );
    for (const id of active) {
      if (!this.workers.has(id)) this.startWorker(id);
    }
    for (const id of [...this.workers.keys()]) {
      if (!active.has(id)) this.stopWorker(id);
    }
  }

  startWorker(accountId) {
    if (this.workers.has(accountId)) return;
    const controller = new AbortController();
    const worker = { controller, promise: null };
    this.workers.set(accountId, worker);
    worker.promise = this.runWorker(accountId, controller.signal)
      .catch(error => {
        if (error?.name !== 'AbortError') {
          const account = this.accountById(accountId);
          this.setState(accountId, { status: 'error', error: error.message, nextAt: new Date(this.now() + ERROR_RETRY_MS).toISOString() });
          if (account) this.log(account, 'error', 'dw.failed', { error: error.message }, `Daily Reward: ${error.message}`);
        }
      })
      .finally(() => {
        if (this.workers.get(accountId) === worker) this.workers.delete(accountId);
      });
  }

  stopWorker(accountId) {
    const worker = this.workers.get(accountId);
    if (worker) worker.controller.abort();
    this.workers.delete(accountId);
    const current = this.states.get(accountId);
    if (current && !['completed', 'reset-wait'].includes(current.status)) this.setState(accountId, { status: 'idle', nextAt: null, timerText: null });
  }

  async runWorker(accountId, signal) {
    while (!signal.aborted) {
      const account = this.accountById(accountId);
      if (!account) return;

      const hold = this.dailyHold(accountId);
      if (hold) {
        this.showDailyHold(accountId, hold);
        await sleep(Math.max(1000, Date.parse(hold.nextAt) - this.now()), signal);
        continue;
      }
      this.clearExpiredDailyHold(accountId);

      let result;
      try {
        result = await this.checkOrClaim(account, signal);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (/auth|session|login|unauthor/i.test(error.message)) this.sessions.invalidate?.(account.id);
        this.setState(accountId, { status: 'error', error: error.message, nextAt: new Date(this.now() + ERROR_RETRY_MS).toISOString() });
        this.log(account, 'error', 'dw.failed', { error: error.message }, `Daily Reward: ${error.message}`);
        result = { delayMs: ERROR_RETRY_MS };
      }
      await sleep(Math.max(1000, Number(result?.delayMs) || 30000), signal);
    }
  }

  _progress(gs, userId, signal) {
    return gs.call('dailyRewards:getProgress', { userId }, 'dailyRewards:progressResult', { signal });
  }

  // One look at the gift: claims every tier that is ready, then says how long to wait.
  async checkOrClaim(account, signal) {
    if (signal?.aborted) throw abortError();
    this.setState(account.id, { status: 'checking', error: null });
    const { userId, cookieHeader: cookie } = await this.sessions.get(account, { owner: 'daily-reward' });
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie, signal });
    try {
      for (let guard = 0; guard < 8; guard++) {
        const progress = await this._progress(gs, userId, signal);
        if (!progress?.success || !progress.data) throw new Error(progress?.error || 'Daily Rewards progress could not be read.');
        const data = progress.data;
        const tier = Number(data.currentTier) || null;
        if (data.isComplete) return this.holdUntilReset(account, 'completed', Number(data.totalTiers) || 6);

        const waitMs = waitMsOf(data, this.now());
        if (waitMs == null) return this.holdUntilReset(account, 'unknown', tier);
        if (waitMs > 0) {
          const delayMs = waitMs + SAFETY_MS;
          this.setState(account.id, {
            status: 'waiting', tier, timerText: formatCountdown(waitMs / 1000),
            nextAt: new Date(this.now() + delayMs).toISOString(), error: null
          });
          return { delayMs };
        }

        this.setState(account.id, { status: 'claiming', tier, timerText: '00:00', error: null });
        const reply = await gs.call('dailyRewards:claim', { userId }, 'dailyRewards:claimResult', { signal });
        if (!reply?.success) {
          const wait = retryAfterMs(reply);
          const message = reply?.error || 'claim refused';
          this.log(account, 'warning', 'dw.refused', { error: message }, `Daily Reward could not be claimed · ${message}`);
          const delayMs = (wait || ERROR_RETRY_MS) + SAFETY_MS;
          this.setState(account.id, { status: 'waiting', tier, timerText: formatCountdown(delayMs / 1000), nextAt: new Date(this.now() + delayMs).toISOString(), error: message });
          return { delayMs };
        }
        const claimedTier = tier || Number(reply.data?.currentTier) || null;
        const items = rewardText(reply.data?.rewards);
        this.log(account, 'success', 'dw.claimed', { tier: claimedTier, rewards: items },
          `Daily Reward${claimedTier ? ` Tier ${claimedTier}` : ''} collected${items ? ` · ${items}` : ''}`);
        this.setState(account.id, { lastClaimAt: new Date(this.now()).toISOString() });
        if (reply.data?.isComplete || claimedTier >= 6) return this.holdUntilReset(account, 'completed', 6);
        await sleep(2000, signal); // the game itself re-reads the progress 2 s after a claim
      }
      return { delayMs: ERROR_RETRY_MS };
    } finally {
      try { gs.close(); } catch {}
    }
  }

  async stop() {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    for (const worker of this.workers.values()) worker.controller.abort();
    this.workers.clear();
  }
}

module.exports = { DailyRewardService, parseCountdown, formatCountdown, nextDailyResetAt, waitMsOf, rewardText, retryAfterMs };
