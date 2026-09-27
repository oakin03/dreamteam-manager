const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app } = require('electron');
const { ensureDir } = require('./store.cjs');

if (app.isPackaged) {
  const bundled = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright-core', '.local-browsers');
  if (fs.existsSync(bundled)) process.env.PLAYWRIGHT_BROWSERS_PATH = bundled;
} else {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

const { chromium } = require('playwright');

const ROOT_URL = 'https://www.dreamteamph.com/';
const MAIN_URL = 'https://www.dreamteamph.com/main';
const CITY_SELECTOR = 'img[alt="City"], img[src*="/iconss/city.webp"]';
const STADIUM_SELECTOR = 'img[alt="Stadium"], img[src*="/iconss/stadium.webp"]';
const AGENT_SELECTOR = 'img[alt="Agent"], img[src*="/stadium/scout.webp"]';

async function firstVisible(locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class BrowserService {
  constructor({ dataDir, activity, stadiumObserver = null }) {
    this.profileRoot = path.join(dataDir, 'browser-profiles');
    this.activity = activity;
    this.shared = new Map();
    this.featureLocks = new Map();
    this.authLocks = new Map();
    this.stadiumObserver = stadiumObserver;
    ensureDir(this.profileRoot);
  }

  profileDir(accountId) { return path.join(this.profileRoot, accountId); }

  setStadiumObserver(observer) {
    this.stadiumObserver = typeof observer === 'function' ? observer : null;
  }

  async _notifyStadium(session, reason = 'explicit') {
    if (!this.stadiumObserver || !session?.accountId || !session?.page || session.closed) return;
    // Collapse duplicate notifications caused by several widgets rendering at once.
    if (session._stadiumNotifyPromise) return session._stadiumNotifyPromise;
    session._stadiumNotifyPromise = Promise.resolve()
      .then(() => this.stadiumObserver(session.accountId, session.page, { reason }))
      .catch(() => {})
      .finally(() => { session._stadiumNotifyPromise = null; });
    return session._stadiumNotifyPromise;
  }

  async _withAuthLock(accountId, fn) {
    const previous = this.authLocks.get(accountId) || Promise.resolve();
    let releaseTail;
    const tail = new Promise(resolve => { releaseTail = resolve; });
    const chained = previous.catch(() => {}).then(() => tail);
    this.authLocks.set(accountId, chained);
    await previous.catch(() => {});
    try {
      return await fn();
    } finally {
      releaseTail();
      if (this.authLocks.get(accountId) === chained) this.authLocks.delete(accountId);
    }
  }


  deleteProfile(accountId) {
    const entry = this.shared.get(accountId);
    if (entry) this._closeEntry(accountId, entry).catch(() => {});
    const dir = this.profileDir(accountId);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  async _launchRaw(account, visible) {
    const profileDir = this.profileDir(account.id);
    ensureDir(profileDir);
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: !visible,
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      args: ['--disable-notifications']
    });
    let page = context.pages()[0];
    if (!page) page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(90000);
    const session = {
      accountId: account.id,
      context,
      page,
      visible,
      closed: false,
      _stadiumVisible: false,
      _stadiumSignature: null,
      _stadiumWatcherBusy: false,
      _stadiumWatcher: null,
      _stadiumNotifyPromise: null,
      async close() {
        if (this.closed) return;
        this.closed = true;
        if (this._stadiumWatcher) clearInterval(this._stadiumWatcher);
        this._stadiumWatcher = null;
        await context.close().catch(() => {});
      }
    };

    // Keep a very light watcher while a browser session is alive. This catches
    // returns to Stadium that are performed by the game UI itself rather than by
    // one of our explicit navigation helpers, so APK/LV/EXP can be refreshed too.
    session._stadiumWatcher = setInterval(async () => {
      if (session.closed || session._stadiumWatcherBusy) return;
      session._stadiumWatcherBusy = true;
      try {
        const atStadium = await page.locator(AGENT_SELECTOR).first().isVisible().catch(() => false);
        if (!atStadium) {
          session._stadiumVisible = false;
          return;
        }
        const signature = await page.evaluate(() => {
          const text = el => (el?.textContent || '').trim();
          const label = [...document.querySelectorAll('span')].find(node => text(node) === 'Auto PK');
          const widget = label?.parentElement?.parentElement;
          const apk = widget?.querySelector('img[alt="Auto PK Tickets"]')?.parentElement;
          const apkText = widget ? (apk ? text(apk) || '0' : '0') : '';
          let lv = '';
          for (const node of document.querySelectorAll('span,div')) {
            const value = text(node);
            if (/^Lv\.?\s*\d{1,2}$/i.test(value)) { lv = value; break; }
          }
          return `${lv}|${apkText}`;
        }).catch(() => '');
        const changed = signature && signature !== session._stadiumSignature;
        const entered = !session._stadiumVisible;
        session._stadiumVisible = true;
        if (signature) session._stadiumSignature = signature;
        if (entered || changed) await this._notifyStadium(session, 'watcher');
      } finally {
        session._stadiumWatcherBusy = false;
      }
    }, 2000);
    session._stadiumWatcher.unref?.();
    return session;
  }

  async _closeEntry(accountId, entry) {
    this.shared.delete(accountId);
    await entry.session.close().catch(() => {});
  }

  async acquire(account, { owner = null, visible = false, forceFresh = false } = {}) {
    owner = owner || `owner:${crypto.randomUUID()}`;
    let entry = this.shared.get(account.id);
    if (entry && entry.session.closed) {
      this.shared.delete(account.id);
      entry = null;
    }
    if (forceFresh && entry) {
      await this._closeEntry(account.id, entry);
      entry = null;
    }

    // A visible Auto Play request must never silently reuse a headless session.
    // Daily Rewards can briefly create a hidden shared Chromium for the same
    // account, so give that short operation time to finish and then relaunch the
    // persistent profile visibly. A visible session may still satisfy hidden
    // callers; only the hidden -> visible direction requires a relaunch.
    if (visible && entry && !entry.session.visible) {
      const deadline = Date.now() + 20000;
      while (entry.owners.size > 0 && Date.now() < deadline) {
        await sleep(150);
        const current = this.shared.get(account.id);
        if (!current || current !== entry || current.session.closed) {
          entry = current || null;
          break;
        }
      }
      if (entry && !entry.session.visible) {
        if (entry.owners.size > 0) {
          throw new Error('Visible Chromium could not open because another browser operation is still using the hidden session.');
        }
        await this._closeEntry(account.id, entry);
        entry = null;
      }
    }

    if (!entry) {
      const session = await this._launchRaw(account, visible);
      if (forceFresh) await session.context.clearCookies().catch(() => {});
      entry = { session, owners: new Set() };
      this.shared.set(account.id, entry);
    }
    entry.owners.add(owner);
    return { session: entry.session, owner };
  }

  async release(accountId, owner, { closeWhenUnused = true } = {}) {
    const entry = this.shared.get(accountId);
    if (!entry) return;
    entry.owners.delete(owner);
    if (closeWhenUnused && entry.owners.size === 0) await this._closeEntry(accountId, entry);
  }


  lockFeature(accountId, feature) {
    if (!this.featureLocks.has(accountId)) this.featureLocks.set(accountId, new Set());
    this.featureLocks.get(accountId).add(feature);
  }

  unlockFeature(accountId, feature) {
    const set = this.featureLocks.get(accountId);
    if (!set) return;
    set.delete(feature);
    if (!set.size) this.featureLocks.delete(accountId);
  }

  isFeatureLocked(accountId) {
    return Boolean(this.featureLocks.get(accountId)?.size);
  }

  featureNames(accountId) {
    return [...(this.featureLocks.get(accountId) || [])];
  }

  async arrangeVisiblePair(mainSession, sideSession) {
    const sessions = [mainSession, sideSession];
    if (!sessions.some(s => s && s.visible && !s.closed)) return;
    const { screen } = require('electron');
    const area = screen.getPrimaryDisplay().workArea;
    for (let i = 0; i < sessions.length; i++) {
      if (!sessions[i] || !sessions[i].visible || sessions[i].closed) continue;
      const pages = sessions[i].context.pages();
      const page = sessions[i].page || pages[0];
      if (!page) continue;
      const cdp = await sessions[i].context.newCDPSession(page).catch(() => null);
      if (!cdp) continue;
      try {
        const { windowId } = await cdp.send('Browser.getWindowForTarget');
        const original = await cdp.send('Browser.getWindowBounds', { windowId });
        const bounds = original.bounds || {};
        // Move the windows to opposite edges without changing the size used
        // when Chromium first opened. A half-width window clips the game's
        // fixed 1440px viewport even though the browser itself looks tiled.
        if (bounds.windowState !== 'normal' || !bounds.width || !bounds.height) continue;
        const x = i === 0 ? area.x : area.x + Math.max(0, area.width - bounds.width);
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { x, y:area.y } });
      } catch {}
      finally { await cdp.detach().catch(() => {}); }
    }
  }

  async forceCloseAccount(accountId) {
    const entry = this.shared.get(accountId);
    if (entry) await this._closeEntry(accountId, entry).catch(() => {});
    this.featureLocks.delete(accountId);
  }

  async closeAll() {
    for (const [accountId, entry] of [...this.shared.entries()]) {
      await this._closeEntry(accountId, entry);
    }
  }

  async sessionData(page) {
    if (!/dreamteamph\.com/i.test(page.url())) return null;
    return page.evaluate(async () => {
      for (const endpoint of ['/api/auth/session', '/api/session']) {
        try {
          const response = await fetch(endpoint, { credentials: 'include', cache: 'no-store' });
          if (response.ok) {
            const json = await response.json();
            if (json?.user?.id) return json;
          }
        } catch {}
      }
      return null;
    }).catch(() => null);
  }

  async loadingState(page) {
    try {
      const body = await page.locator('body').innerText({ timeout: 1500 });
      const low = body.toLowerCase();
      const active = low.includes('loading game assets') || low.includes('preparing the court') || low.includes('almost ready to tip-off');
      if (!active) return { active: false, counter: null };
      const m = body.match(/loading\s+game\s+assets\s*(\d+)\s*\/\s*(\d+)/i) || body.match(/(?<!\d)(\d+)\s*\/\s*(\d+)(?!\d)/);
      return { active: true, counter: m ? `${m[1]}/${m[2]}` : null };
    } catch {
      return { active: false, counter: null };
    }
  }

  async mainReady(page) {
    const loading = await this.loadingState(page);
    if (loading.active) return false;
    const candidates = [page.locator(CITY_SELECTOR).first(), page.locator('img[alt="Match"]').first(), page.locator(AGENT_SELECTOR).first()];
    for (const item of candidates) {
      if (await item.isVisible().catch(() => false)) {
        try { await item.click({ trial: true, timeout: 800 }); return true; } catch {}
      }
    }
    return false;
  }

  async waitForMain(page, { timeoutMs = 150000, log = () => {} } = {}) {
    const end = Date.now() + timeoutMs;
    let lastMsg = '';
    while (Date.now() < end) {
      const loading = await this.loadingState(page);
      if (loading.active) {
        const msg = loading.counter ? `Loading game assets · ${loading.counter}` : 'Loading game assets…';
        if (msg !== lastMsg) { log('info', msg); lastMsg = msg; }
        await sleep(350);
        continue;
      }
      if (await this.mainReady(page)) return true;
      await sleep(350);
    }
    throw new Error('Main screen did not become ready.');
  }

  async _waitForLoginOrSession(page, { timeoutMs = 150000, log = () => {} } = {}) {
    const startedAt = Date.now();
    const end = startedAt + timeoutMs;
    let recoveryStep = 0;
    let lastLoadingMsg = '';

    while (Date.now() < end) {
      const data = await this.sessionData(page);
      if (data?.user?.id && await this.mainReady(page)) return { type: 'ready', sessionData: data };

      const pwd = await firstVisible(page.locator('input[type="password"]'));
      const user = await firstVisible(page.locator('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'));
      const enter = page.getByRole('button', { name: /ENTER\s+THE\s+GAME/i }).first();
      // Some startup screens briefly expose an ENTER button before the actual
      // login inputs are mounted. Only declare the login form ready when both
      // inputs are visible and the submit button is usable.
      if (pwd && user && await enter.isVisible().catch(() => false)) {
        return { type: 'login', sessionData: data };
      }

      const loading = await this.loadingState(page);
      if (loading.active) {
        const msg = loading.counter ? `Loading game assets · ${loading.counter}` : 'Loading game assets…';
        if (msg !== lastLoadingMsg) { log('info', msg); lastLoadingMsg = msg; }
        await sleep(400);
        continue;
      }

      const elapsed = Date.now() - startedAt;
      // A stale /main shell can remain on screen after the persisted session expires.
      // Recover it instead of waiting the full timeout for a login form that will never render.
      if (recoveryStep === 0 && elapsed >= 30000) {
        recoveryStep = 1;
        log('info', 'Refreshing sign-in screen…');
        await page.goto(ROOT_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(700);
        continue;
      }
      if (recoveryStep === 1 && elapsed >= 70000) {
        recoveryStep = 2;
        await page.goto(MAIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(700);
        continue;
      }
      if (recoveryStep === 2 && elapsed >= 110000) {
        recoveryStep = 3;
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await sleep(700);
        continue;
      }

      await sleep(400);
    }
    throw new Error('Login screen did not appear in time.');
  }

  async ensureAuthenticated(account, credentials, session, { log = () => {} } = {}) {
    const { page } = session;
    let existing = await this.sessionData(page);
    if (existing?.user?.id) {
      if (!(await this.mainReady(page))) {
        // A feature/modal may already be open; the session itself is still valid.
        return existing;
      }
      await this._notifyStadium(session);
      return existing;
    }

    log('info', 'Opening DreamTeam…');
    if (!/dreamteamph\.com/i.test(page.url()) || page.url() === 'about:blank') {
      await page.goto(MAIN_URL, { waitUntil: 'domcontentloaded' }).catch(async () => {
        await page.goto(ROOT_URL, { waitUntil: 'domcontentloaded' });
      });
    }

    const state = await this._waitForLoginOrSession(page, { log });
    if (state.type === 'ready' && state.sessionData?.user?.id) {
      await this._notifyStadium(session);
      return state.sessionData;
    }

    let filled = false;
    let lastFillError = null;
    for (let attempt = 0; attempt < 4 && !filled; attempt++) {
      const pwd = await firstVisible(page.locator('input[type="password"]'));
      const user = await firstVisible(page.locator('input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"])'));
      const button = page.getByRole('button', { name: /ENTER\s+THE\s+GAME/i }).first();
      if (!user || !pwd || !(await button.isVisible().catch(() => false))) {
        await sleep(500);
        continue;
      }
      try {
        await user.fill(credentials.login, { timeout: 5000 });
        await pwd.fill(credentials.password, { timeout: 5000 });
        filled = true;
      } catch (error) {
        lastFillError = error;
        await sleep(600);
      }
    }
    if (!filled) throw new Error(`Login fields could not be filled${lastFillError ? `: ${lastFillError.message}` : '.'}`);

    const button = page.getByRole('button', { name: /ENTER\s+THE\s+GAME/i }).first();
    await button.waitFor({ state: 'visible', timeout: 30000 });
    log('info', 'Signing in…');
    await button.click();
    await this.waitForMain(page, { timeoutMs: 180000, log });
    await this._notifyStadium(session);
    existing = await this.sessionData(page);
    if (!existing?.user?.id) throw new Error('Login succeeded but the account session could not be read.');
    return existing;
  }

  async authenticate(account, credentials, options = {}) {
    const {
      visible = false,
      forceFresh = false,
      keepOpen = false,
      owner = `auth:${crypto.randomUUID()}`,
      log = () => {}
    } = options;

    const acquired = await this.acquire(account, { owner, visible, forceFresh });
    const session = acquired.session;
    try {
      // Auto Play and Daily Rewards can start at almost the same moment. They
      // share one persistent page, so concurrent login attempts used to race and
      // detach the password input while the other flow was filling it. Serialize
      // authentication per account while still allowing both owners to share the
      // authenticated session afterwards.
      const sessionData = await this._withAuthLock(account.id, () =>
        this.ensureAuthenticated(account, credentials, session, { log })
      );
      const cookies = await session.context.cookies(['https://dreamteamph.com', 'https://www.dreamteamph.com']);
      const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      const result = { session, owner, userId: sessionData?.user?.id || null, cookieHeader, cookies, sessionData };
      if (!keepOpen) await this.release(account.id, owner, { closeWhenUnused: true });
      return result;
    } catch (error) {
      await this.release(account.id, owner, { closeWhenUnused: true }).catch(() => {});
      throw error;
    }
  }

  async waitForSelectorReady(page, selector, timeoutMs = 90000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const loading = await this.loadingState(page);
      if (loading.active) { await sleep(300); continue; }
      const loc = page.locator(selector).first();
      if (await loc.isVisible().catch(() => false)) return loc;
      await sleep(300);
    }
    throw new Error(`Timed out waiting for ${selector}`);
  }

  async normalizeToStadium(session, log = () => {}) {
    const { page } = session;
    for (let attempt = 0; attempt < 5; attempt++) {
      const loading = await this.loadingState(page);
      if (loading.active) { await sleep(400); continue; }

      const agent = page.locator(AGENT_SELECTOR).first();
      if (await agent.isVisible().catch(() => false)) {
        await this._notifyStadium(session);
        return true;
      }

      const stadium = page.locator(STADIUM_SELECTOR).first();
      if (await stadium.isVisible().catch(() => false)) {
        log('info', 'Returning to Stadium…');
        await stadium.click();
        await sleep(500);
        await this.waitForSelectorReady(page, AGENT_SELECTOR, 90000);
        await this._notifyStadium(session);
        return true;
      }

      // Close Match/Scout/other overlays first. On the main stadium screen ESC is harmless.
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(700);
    }

    if (await page.locator(CITY_SELECTOR).first().isVisible().catch(() => false)) {
      // City icon means we are on the stadium/main screen; wait for Agent to finish rendering.
      await this.waitForSelectorReady(page, AGENT_SELECTOR, 60000);
      await this._notifyStadium(session);
      return true;
    }
    throw new Error('Could not return to the Stadium screen.');
  }

  async openMatchScreen(session, log = () => {}) {
    const { page } = session;
    const quickButton = page.getByRole('button', { name: /Quick\s+Play/i }).first();
    if (await quickButton.isVisible().catch(() => false)) return quickButton;

    await this.normalizeToStadium(session, log).catch(() => {});
    const matchIcon = await this.waitForSelectorReady(page, 'img[alt="Match"]', 90000);
    log('info', 'Opening Match…');
    await matchIcon.click();
    await quickButton.waitFor({ state: 'visible', timeout: 90000 });
    return quickButton;
  }

  async recoverMatchScreen(session, log = () => {}) {
    const { page } = session;
    log('warning', 'Refreshing the Match screen…');
    await page.goto(MAIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await this.waitForMain(page, { timeoutMs: 150000, log });
    await this._notifyStadium(session);
    return this.openMatchScreen(session, log);
  }
}

module.exports = { BrowserService, ROOT_URL, MAIN_URL, CITY_SELECTOR, STADIUM_SELECTOR, AGENT_SELECTOR };
