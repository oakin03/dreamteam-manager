const crypto = require('crypto');

const DAILY_REWARD_SELECTOR = 'img[alt="Daily Rewards"], img[src*="/icons/gift.webp"]';
const REWARD_STATUS_SELECTOR = '[role="status"][aria-label="Daily rewards received"]';

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

function looksCompletedRewardText(text) {
  const low = String(text || '').toLowerCase();
  return /(?:6\s*\/\s*6|all\s+(?:daily\s+)?rewards?|rewards?\s+(?:are\s+)?complete|completed\s+(?:for\s+)?today|come\s+back\s+tomorrow|already\s+claimed|claimed\s+all|no\s+more\s+rewards?)/i.test(low);
}

async function readMainRewardState(page) {
  return page.evaluate((selector) => {
    const img = document.querySelector(selector);
    if (!img) return { present: false, timerText: null, rewardText: '' };

    // The timer belongs to the compact Daily Rewards widget. Do not walk far up
    // the Stadium DOM: when the reward is ready the widget can contain no timer,
    // and an old implementation could accidentally pick an unrelated HH:MM text
    // elsewhere on the page and postpone the claim.
    const timeRe = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
    const button = img.closest('button');
    const candidates = [
      img.parentElement,
      button?.parentElement,
      button?.parentElement?.parentElement
    ].filter(Boolean);
    // The tooltip is inside the gift widget. Do not inspect the whole Stadium:
    // the bench also has a 6/6 counter which is unrelated to Daily Rewards.
    const rewardText = String(button?.parentElement?.parentElement?.innerText ||
      button?.parentElement?.innerText || '').trim();

    for (const node of candidates) {
      const text = (node.innerText || node.textContent || '').trim();
      const matches = text.match(timeRe);
      if (matches?.length) return { present: true, timerText: matches[matches.length - 1], rewardText };
    }
    return { present: true, timerText: null, rewardText };
  }, DAILY_REWARD_SELECTOR).catch(() => ({ present: false, timerText: null, rewardText: '' }));
}

function classifyRewardText(text) {
  const raw = String(text || '');
  const low = raw.toLowerCase();
  const tierMatch = raw.match(/tier\s+(\d+)/i);
  const tier = tierMatch ? Number(tierMatch[1]) : null;
  const readyMatch = raw.match(/ready\s+in\s+(\d{1,2}:\d{2}(?::\d{2})?)/i);
  if (looksCompletedRewardText(raw)) {
    return { type: 'completed', tier, timerText: null };
  }
  if (low.includes('waiting for the timer')) {
    return { type: 'waiting', tier, timerText: readyMatch?.[1] || null };
  }
  if (low.includes('collected') && low.includes('rewards received')) {
    return { type: tier >= 6 ? 'completed' : 'collected', tier, timerText: null };
  }
  return { type: 'unknown', tier, timerText: readyMatch?.[1] || null };
}

class DailyRewardService {
  constructor({ store, credentials, browserService, activity, engine, onChanged }) {
    this.store = store;
    this.credentials = credentials;
    this.browser = browserService;
    this.activity = activity;
    this.engine = engine;
    this.onChanged = onChanged;
    this.states = new Map();
    this.workers = new Map();
    this.stadiumInspections = new Map();
    this.claimingAccounts = new Set();
    this.monitor = null;
    for (const [id, hold] of Object.entries(this.store.getDailyRewards()?.accounts || {})) {
      if (Date.parse(hold?.nextAt) > Date.now()) this.showDailyHold(id, hold);
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

  log(account, level, message) {
    this.activity.add({ level, accountId: account.id, accountName: account.name, message });
  }

  setState(accountId, patch) {
    const current = this.states.get(accountId) || { status: 'idle', timerText: null, nextAt: null, tier: null, lastClaimAt: null, error: null };
    this.states.set(accountId, { ...current, ...patch });
    this.onChanged?.();
  }

  dailyHold(accountId) {
    const hold = this.store.getDailyRewards()?.accounts?.[accountId];
    return Date.parse(hold?.nextAt) > Date.now() ? hold : null;
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
      return { delayMs: Math.max(1000, Date.parse(existing.nextAt) - Date.now()) };
    }
    const nextAt = new Date(nextDailyResetAt()).toISOString();
    const saved = this.store.getDailyRewards();
    const hold = { reason, tier, nextAt };
    this.store.saveDailyRewards({
      ...saved, version: 1, accounts: { ...(saved?.accounts || {}), [account.id]: hold }
    });
    this.showDailyHold(account.id, hold);
    if (reason === 'completed') this.log(account, 'success', 'Daily Rewards completed for today.');
    else this.log(account, 'warning', 'Daily Reward result was not recognized; waiting until the next daily reset (19:00 Türkiye time).');
    return { delayMs: Math.max(1000, Date.parse(nextAt) - Date.now()) };
  }

  async inspectStadium(accountId, page) {
    if (!accountId || !page || this.claimingAccounts.has(accountId)) return null;
    const account = this.accountById(accountId);
    if (!account) return null;
    const hold = this.dailyHold(accountId);
    if (hold) {
      this.showDailyHold(accountId, hold);
      return null;
    }

    const existing = this.stadiumInspections.get(accountId);
    if (existing) return existing;

    const job = (async () => {
      const main = await readMainRewardState(page);
      if (!main.present) return null;
      if (looksCompletedRewardText(main.rewardText)) return this.holdUntilReset(account, 'completed', 6);

      const seconds = parseCountdown(main.timerText);
      if (Number.isFinite(seconds) && seconds > 0) {
        const delayMs = Math.max(1000, seconds * 1000 + 250);
        this.setState(accountId, {
          status: 'waiting', timerText: main.timerText,
          nextAt: new Date(Date.now() + delayMs).toISOString(), error: null
        });
        return { delayMs };
      }

      // A visible 00:00 (or a completed-day state with no countdown) is checked
      // immediately at every safe Stadium arrival. This hook is awaited by the
      // caller, so on first Start the reward check happens before the normal task
      // leaves Stadium. After clicking, wait five seconds exactly as requested.
      this.log(account, 'info', 'Daily Reward is claimable · claiming now…');
      this.claimingAccounts.add(accountId);
      try {
        return await this.claimOnPage(account, page);
      } catch (error) {
        this.setState(accountId, { status: 'error', error: error.message });
        this.log(account, 'warning', `Daily Reward Stadium check: ${error.message}`);
        return null;
      } finally {
        this.claimingAccounts.delete(accountId);
      }
    })().finally(() => {
      if (this.stadiumInspections.get(accountId) === job) this.stadiumInspections.delete(accountId);
    });

    this.stadiumInspections.set(accountId, job);
    return job;
  }

  start() {
    if (this.monitor) return;
    this.monitor = setInterval(() => this.sync().catch(() => {}), 2000);
    this.sync().catch(() => {});
  }

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
          this.setState(accountId, { status: 'error', error: error.message, nextAt: new Date(Date.now() + 60000).toISOString() });
          if (account) this.log(account, 'error', `Daily Reward: ${error.message}`);
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
    if (current) this.setState(accountId, { status: 'idle', nextAt: null });
  }

  async runWorker(accountId, signal) {
    while (!signal.aborted) {
      const account = this.accountById(accountId);
      if (!account) return;

      const hold = this.dailyHold(accountId);
      if (hold) {
        this.showDailyHold(accountId, hold);
        await sleep(Math.max(1000, Date.parse(hold.nextAt) - Date.now()), signal);
        continue;
      }
      this.clearExpiredDailyHold(accountId);

      // A Stadium arrival may already have inspected the reward and scheduled the
      // exact next claim. Respect that schedule instead of immediately opening a
      // second browser flow that can fight with Auto Play during startup.
      const scheduled = this.states.get(accountId);
      const scheduledAt = scheduled?.nextAt ? Date.parse(scheduled.nextAt) : NaN;
      if ((scheduled?.status === 'waiting' || scheduled?.status === 'completed') && Number.isFinite(scheduledAt) && scheduledAt > Date.now() + 500) {
        await sleep(Math.max(1000, scheduledAt - Date.now()), signal);
        continue;
      }

      let result;
      try {
        result = await this.checkOrClaim(account, signal);
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        this.setState(accountId, { status: 'error', error: error.message });
        this.log(account, 'error', `Daily Reward: ${error.message}`);
        result = { delayMs: 60000 };
      }

      const delayMs = Math.max(1000, Number(result?.delayMs || 30000));
      const nextAt = new Date(Date.now() + delayMs).toISOString();
      const state = this.states.get(accountId);
      if (!['waiting', 'completed', 'reset-wait'].includes(state?.status)) this.setState(accountId, { nextAt });
      await sleep(delayMs, signal);
    }
  }

  async installRewardCapture(page) {
    await page.evaluate(() => {
      try { window.__dtmDailyRewardObserver?.disconnect?.(); } catch {}
      const state = { items: [] };
      window.__dtmDailyRewardCapture = state;

      const remember = (node) => {
        if (!(node instanceof Element)) return;
        const candidates = [node];
        const status = node.closest?.('[role="status"], [role="dialog"]');
        if (status && status !== node) candidates.push(status);
        for (const el of node.querySelectorAll?.('[role="status"], [role="dialog"]') || []) candidates.push(el);

        for (const el of candidates) {
          const text = String(el.innerText || el.textContent || '').trim();
          if (!text) continue;
          if (!/(daily\s*rewards?|tier\s*\d+|rewards?\s+received|waiting\s+for\s+the\s+timer|ready\s+in|collected|claimed|complete|come\s+back)/i.test(text)) continue;
          const item = { text: text.slice(0, 5000), html: String(el.outerHTML || '').slice(0, 20000), at: Date.now() };
          const previous = state.items[state.items.length - 1];
          if (!previous || previous.text !== item.text) state.items.push(item);
          if (state.items.length > 20) state.items.shift();
        }
      };

      for (const el of document.querySelectorAll('[role="status"], [role="dialog"]')) remember(el);
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.target instanceof Element) remember(mutation.target);
          for (const node of mutation.addedNodes || []) if (node instanceof Element) remember(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      window.__dtmDailyRewardObserver = observer;
    }).catch(() => {});
  }

  async readRewardCapture(page) {
    return page.evaluate(() => {
      try { window.__dtmDailyRewardObserver?.disconnect?.(); } catch {}
      const items = Array.isArray(window.__dtmDailyRewardCapture?.items) ? window.__dtmDailyRewardCapture.items : [];
      return items.map(item => item?.text || '').filter(Boolean).join('\n---\n');
    }).catch(() => '');
  }

  async waitForRewardResult(page, timeoutMs = 6000) {
    const status = page.locator(REWARD_STATUS_SELECTOR).first();
    try {
      await status.waitFor({ state: 'attached', timeout: timeoutMs });
      const text = await status.innerText({ timeout: 1200 }).catch(() => '');
      if (text) return classifyRewardText(text);
    } catch {}

    // The reward overlay is intentionally short-lived. Keep a tiny polling fallback
    // so we do not miss it between Playwright's normal polling intervals.
    const end = Date.now() + 1800;
    while (Date.now() < end) {
      const text = await page.locator(REWARD_STATUS_SELECTOR).first().innerText({ timeout: 150 }).catch(() => '');
      if (text) return classifyRewardText(text);
      await sleep(50);
    }
    return { type: 'unknown', tier: null, timerText: null };
  }

  async dismissRewardOverlay(page) {
    const overlay = page.locator(REWARD_STATUS_SELECTOR).first();
    if (!(await overlay.isVisible().catch(() => false))) return;
    await overlay.click({ position: { x: 10, y: 10 }, timeout: 1200 }).catch(() => {});
    await overlay.waitFor({ state: 'hidden', timeout: 2500 }).catch(() => {});
  }

  async waitForMainTimer(page, timeoutMs = 7000) {
    const end = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < end) {
      last = await readMainRewardState(page);
      const seconds = parseCountdown(last?.timerText);
      if (Number.isFinite(seconds) && seconds > 0) return { ...last, seconds };
      await sleep(250);
    }
    const seconds = parseCountdown(last?.timerText);
    return { ...(last || {}), seconds };
  }

  async claimOnPage(account, page, signal = null) {
    const before = await readMainRewardState(page);
    if (looksCompletedRewardText(before.rewardText)) return this.holdUntilReset(account, 'completed', 6);
    this.setState(account.id, { status: 'claiming', timerText: before.timerText || '00:00', error: null });

    const gift = page.locator(DAILY_REWARD_SELECTOR).first();
    await gift.waitFor({ state: 'visible', timeout: 15000 });
    await this.installRewardCapture(page);

    const button = gift.locator('xpath=ancestor::button[1]');
    if (await button.count()) await button.click({ timeout: 5000 });
    else await gift.click({ timeout: 5000 });
    this.log(account, 'info', 'Daily Reward clicked · waiting 5 seconds…');
    await sleep(5000, signal || undefined);

    const capturedText = await this.readRewardCapture(page);
    let result = classifyRewardText(capturedText);
    if (result.type === 'unknown') result = await this.waitForRewardResult(page, 500);

    if (result.type === 'waiting') {
      const seconds = parseCountdown(result.timerText);
      const delayMs = Number.isFinite(seconds) ? Math.max(1000, seconds * 1000 + 250) : 60000;
      this.setState(account.id, {
        status: 'waiting', tier: result.tier, timerText: result.timerText,
        nextAt: new Date(Date.now() + delayMs).toISOString(), error: null
      });
      await this.dismissRewardOverlay(page);
      return { delayMs };
    }

    if (result.type === 'completed') {
      const hold = this.holdUntilReset(account, 'completed', result.tier || 6);
      this.setState(account.id, { lastClaimAt: new Date().toISOString() });
      await this.dismissRewardOverlay(page);
      return hold;
    }

    if (result.type === 'collected') {
      const claimedAt = new Date().toISOString();
      this.log(account, 'success', `Daily Reward${result.tier ? ` Tier ${result.tier}` : ''} collected.`);
      await this.dismissRewardOverlay(page);
      if (result.tier >= 6) {
        const hold = this.holdUntilReset(account, 'completed', 6);
        this.setState(account.id, { lastClaimAt: claimedAt });
        return hold;
      }
      const next = await this.waitForMainTimer(page, 4000);
      const seconds = Number.isFinite(next.seconds) && next.seconds > 0 ? next.seconds : null;
      if (seconds != null) {
        const delayMs = Math.max(1000, seconds * 1000 + 250);
        this.setState(account.id, {
          status: 'waiting', tier: result.tier,
          timerText: next.timerText || formatCountdown(seconds),
          nextAt: new Date(Date.now() + delayMs).toISOString(),
          lastClaimAt: claimedAt, error: null
        });
        return { delayMs };
      }
    }

    // Even when the short popup disappears before we can classify it, a new
    // positive Stadium countdown proves that the claim succeeded.
    const after = await this.waitForMainTimer(page, 2500);
    const afterSeconds = parseCountdown(after.timerText);
    if (Number.isFinite(afterSeconds) && afterSeconds > 0) {
      const delayMs = Math.max(1000, afterSeconds * 1000 + 250);
      this.log(account, 'success', 'Daily Reward collected.');
      this.setState(account.id, {
        status: 'waiting', timerText: after.timerText,
        nextAt: new Date(Date.now() + delayMs).toISOString(),
        lastClaimAt: new Date().toISOString(), error: null
      });
      return { delayMs };
    }

    const hold = this.holdUntilReset(account, 'unknown', result.tier);
    await this.dismissRewardOverlay(page);
    return hold;
  }

  async checkOrClaim(account, signal) {
    if (signal.aborted) throw abortError();
    const hold = this.dailyHold(account.id);
    if (hold) {
      this.showDailyHold(account.id, hold);
      return { delayMs: Math.max(1000, Date.parse(hold.nextAt) - Date.now()) };
    }
    if (this.claimingAccounts.has(account.id)) return { delayMs: 5000 };

    // Scout and other interactive screens own the page until the user closes them.
    // Do not force navigation away from them; retry shortly instead.
    if (this.browser.isFeatureLocked(account.id)) {
      this.setState(account.id, { status: 'deferred', error: null, nextAt: null });
      return { delayMs: 20000 };
    }

    this.claimingAccounts.add(account.id);
    this.browser.lockFeature(account.id, 'daily-reward');
    const owner = `daily-reward:${account.id}:${crypto.randomUUID()}`;
    let auth = null;
    const runtimeBefore = this.engine.states()[account.id] || {};
    const shouldRestoreMatch = runtimeBefore.status === 'running' && runtimeBefore.mode === 'browser';

    try {
      this.setState(account.id, { status: 'checking', error: null, nextAt: null });
      auth = await this.browser.authenticate(account, {
        login: account.login,
        password: this.credentials.decryptSecret(account.passwordEncrypted)
      }, {
        visible: false,
        keepOpen: true,
        owner,
        log: (level, message) => {
          if (/opening dreamteam|signing in|loading game assets/i.test(String(message))) this.log(account, level, `Daily Reward · ${message}`);
        }
      });

      if (signal.aborted) throw abortError();
      await this.browser.normalizeToStadium(auth.session, (level, message) => this.log(account, level, `Daily Reward · ${message}`));
      const page = auth.session.page;
      await this.dismissRewardOverlay(page);

      const main = await readMainRewardState(page);
      if (!main.present) throw new Error('Daily Rewards icon could not be found on Stadium.');
      if (looksCompletedRewardText(main.rewardText)) return this.holdUntilReset(account, 'completed', 6);
      const mainSeconds = parseCountdown(main.timerText);

      if (Number.isFinite(mainSeconds) && mainSeconds > 0) {
        const delayMs = Math.max(1000, mainSeconds * 1000 + 250);
        this.setState(account.id, {
          status: 'waiting',
          timerText: main.timerText,
          nextAt: new Date(Date.now() + delayMs).toISOString(),
          error: null
        });
        return { delayMs };
      }

      return await this.claimOnPage(account, page, signal);
    } finally {
      try {
        if (auth?.session && shouldRestoreMatch && this.engine.states()[account.id]?.status === 'running') {
          await this.dismissRewardOverlay(auth.session.page);
          await this.browser.openMatchScreen(auth.session, (level, message) => this.log(account, level, `Daily Reward · ${message}`));
        }
      } catch (error) {
        this.log(account, 'warning', `Daily Reward · Match restore failed: ${error.message}`);
      }
      if (auth?.owner) await this.browser.release(account.id, auth.owner, { closeWhenUnused: true }).catch(() => {});
      this.browser.unlockFeature(account.id, 'daily-reward');
      this.claimingAccounts.delete(account.id);
    }
  }

  async stop() {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    for (const [id, worker] of this.workers) {
      worker.controller.abort();
      this.browser.unlockFeature(id, 'daily-reward');
    }
    this.workers.clear();
  }
}

module.exports = { DailyRewardService, parseCountdown, formatCountdown, classifyRewardText, nextDailyResetAt, readMainRewardState };
