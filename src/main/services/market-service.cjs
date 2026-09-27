const { readStadiumTelemetry } = require('./account-profile-service.cjs');

const CITY_SELECTOR = 'img[alt="City"], img[src*="/iconss/city.webp"]';
const STADIUM_SELECTOR = 'img[alt="Stadium"], img[src*="/iconss/stadium.webp"]';
const AGENT_SELECTOR = 'img[alt="Agent"], img[src*="/stadium/scout.webp"]';
const BUILDING_SELECTOR = 'div.absolute.cursor-pointer[style*="top: 260px"][style*="left: 220px"][style*="width: 200px"][style*="height: 120px"]';
const LISTING_CARD = 'div[class*="group/card"]';
const CONFIRM_DIALOG = '[role="dialog"][aria-label="Claim confirmation"]';
const SUCCESS_DIALOG = '[role="dialog"][aria-label="Success"]';

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Runs inside the game page; only the currently selected My Listings cards are read.
function readMarketView() {
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const integer = value => {
    const raw = String(value || '').replace(/[,\s]/g, '');
    return /^\d+$/.test(raw) ? Number(raw) : null;
  };
  const listingHeading = [...document.querySelectorAll('h1,h2,h3')]
    .find(node => /^My Listings$/i.test(text(node)));
  const listingOpen = Boolean(listingHeading);
  // Trading Hall stays mounted behind My Listings and has its own pager.
  const listingRoot = listingHeading?.closest?.('div.absolute.inset-0') ||
    listingHeading?.closest?.('[role="dialog"]') || document;
  const select = selector => [...listingRoot.querySelectorAll(selector)];
  const buttons = select('button');
  const first = buttons.find(button => text(button) === '«');
  const pagerNode = first?.parentElement;
  const counter = [...(pagerNode?.children || [])]
    .find(node => node.tagName === 'SPAN' && /^\d+\s*\/\s*\d+$/.test(text(node))) ||
    select('span').find(node => /^\d+\s*\/\s*\d+$/.test(text(node)) &&
      /\bgap-1\b/.test(String(node.parentElement?.className || '')));
  const numbers = text(counter).match(/^(\d+)\s*\/\s*(\d+)$/);
  const pagination = numbers && Number(numbers[1]) > 0 && Number(numbers[1]) <= Number(numbers[2])
    ? { current: Number(numbers[1]), total: Number(numbers[2]) } : null;

  const field = (card, label) => {
    for (const node of card.querySelectorAll('div')) {
      if (text(node) !== label) continue;
      const siblings = [...(node.parentElement?.children || [])];
      const next = siblings[siblings.indexOf(node) + 1];
      if (next) return text(next);
    }
    return '';
  };
  const cards = select('div[class*="group/card"]');
  const rows = cards.map((card, index) => {
    const image = [...card.querySelectorAll('img')].find(img => {
      const src = img.getAttribute('src') || '';
      return img.getAttribute('alt') && (/\/players\//i.test(src) || /%2fplayers%2f/i.test(src));
    });
    const heading = card.querySelector('h3');
    const marker = card.querySelector('img[alt="ticket"]') ||
      [...card.querySelectorAll('span')].find(span => text(span) === '🎮');
    const currency = marker?.tagName === 'IMG' ? 'TIX' : marker ? 'APK' : null;
    const amount = marker && [...marker.parentElement.querySelectorAll('span')]
      .map(span => integer(text(span))).find(value => value !== null);
    const status = field(card, 'Status').toUpperCase();
    return {
      index, name: text(heading), fullName: (image?.getAttribute('alt') || '').trim(),
      imagePath: image?.getAttribute('src') || '', salary: integer(field(card, 'Salary')),
      status, price: amount ?? null, currency
    };
  });
  const invalid = rows.some(row => !row.fullName || row.salary === null ||
    row.price === null || !row.currency || !['SOLD', 'LISTED', 'EXPIRED'].includes(row.status));
  const headerCounts = select('span').map(node => text(node).match(/^(Listed|Sold|Expired):\s*(\d+)$/i))
    .filter(Boolean);
  const headerCount = new Set(headerCounts.map(match => match[1].toLowerCase())).size === 3
    ? headerCounts.reduce((sum, match) => sum + Number(match[2]), 0) : null;
  const bodyText = text(listingRoot === document ? listingHeading?.closest?.('main') || document.body : listingRoot);
  const empty = /(?:no listings|no active listings|no players listed|nothing listed)/i.test(bodyText);
  const signature = rows.map(row => [row.fullName, row.imagePath, row.salary, row.status, row.price, row.currency].join('|')).join('\n');
  return { listingOpen, pagination, rows, cardCount: cards.length, headerCount, invalid,
    empty, loading: /loading (?:listings|players)/i.test(bodyText), signature };
}

function clickMarketPager(label) {
  const text = node => (node?.textContent || '').trim();
  const heading = [...document.querySelectorAll('h1,h2,h3')]
    .find(node => /^My Listings$/i.test(text(node)));
  if (!heading) return false;
  const root = heading.closest?.('div.absolute.inset-0') ||
    heading.closest?.('[role="dialog"]') || document;
  const first = [...root.querySelectorAll('button')].find(button => text(button) === '«');
  const parent = first?.parentElement;
  if (!parent) return false;
  const buttons = [...parent.children].filter(node => node.tagName === 'BUTTON');
  if (!['«', '‹', '›', '»'].every(key => buttons.some(node => text(node) === key))) return false;
  if (![...parent.children].some(node => node.tagName === 'SPAN' && /^\d+\s*\/\s*\d+$/.test(text(node)))) return false;
  const button = buttons.find(node => text(node) === label);
  if (!button || button.disabled || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
  button.click();
  return true;
}

class MarketService {
  constructor({ store, credentials, browserService, accountProfile, activity, onChanged }) {
    this.store = store;
    this.credentials = credentials;
    this.browser = browserService;
    this.accountProfile = accountProfile;
    this.activity = activity;
    this.onChanged = onChanged;
    this.states = new Map();
    this.jobs = new Map();
  }

  account(accountId) {
    const found = this.store.getAccounts().find(account => account.id === accountId);
    if (!found) throw new Error('Account not found.');
    return found;
  }

  state(accountId) {
    if (!this.states.has(accountId)) this.states.set(accountId, {
      status: 'closed', page: 0, totalPages: 0, rows: [], claimed: 0,
      scannedAt: null, pendingApkRefresh: false, error: null, session: null, owner: null
    });
    return this.states.get(accountId);
  }

  set(accountId, patch) {
    Object.assign(this.state(accountId), patch);
    this.onChanged?.();
  }

  snapshot() {
    const out = {};
    for (const [id, s] of this.states) {
      const { session, owner, ...publicState } = s;
      out[id] = { ...publicState, browserOpen: Boolean(session && !session.closed) };
    }
    return out;
  }

  log(account, level, message) {
    this.activity.add({ level, accountId: account.id, accountName: account.name, message });
  }

  async _operation(accountId, status, action) {
    if (this.jobs.has(accountId)) throw new Error('Another Market operation is running for this account.');
    const account = this.account(accountId);
    const controller = new AbortController();
    this.set(accountId, { status, error: null });
    const job = (async () => {
      try { return await action(account, this.state(accountId), controller.signal); }
      catch (error) {
        this.set(accountId, { status: 'error', error: error.message });
        this.log(account, 'error', `Market: ${error.message}`);
        if (status !== 'claiming' && !this.state(accountId).pendingApkRefresh) await this._closeSession(accountId);
        throw error;
      }
    })();
    this.jobs.set(accountId, { controller, promise: job, status });
    try { return await job; }
    finally { this.jobs.delete(accountId); }
  }

  async _ensureSession(account, signal) {
    const s = this.state(account.id);
    for (let attempt = 0; attempt < 60; attempt++) {
      if (signal.aborted) throw abortError();
      const locks = (this.browser.featureNames?.(account.id) || []).filter(name => name !== 'market');
      if (!locks.length) break;
      if (locks.some(name => name !== 'autoplay-action' && name !== 'daily-reward')) {
        throw new Error(`Close the other game screen first: ${locks.join(', ')}`);
      }
      if (attempt === 59) throw new Error('Another game action is still using this account.');
      await sleep(250, signal);
    }
    if (s.session && !s.session.closed) return s.session;
    this.browser.lockFeature(account.id, 'market');
    try {
      const auth = await this.browser.authenticate(account, {
        login: account.login,
        password: this.credentials.decryptSecret(account.passwordEncrypted)
      }, { visible: false, keepOpen: true, owner: `market:${account.id}`,
        log: (level, message) => this.log(account, level, message) });
      s.session = auth.session;
      s.owner = auth.owner;
      this.onChanged?.();
      return auth.session;
    } catch (error) {
      this.browser.unlockFeature(account.id, 'market');
      throw error;
    }
  }

  async _closeSession(accountId) {
    const s = this.state(accountId);
    const owner = s.owner;
    s.session = null;
    s.owner = null;
    this.browser.unlockFeature(accountId, 'market');
    if (owner) await this.browser.release(accountId, owner, { closeWhenUnused: true }).catch(() => {});
    this.onChanged?.();
  }

  async _view(page) { return page.evaluate(readMarketView).catch(() => null); }

  async _waitPage(page, target, signal, previousSignature = null, timeoutMs = 30000) {
    const end = Date.now() + timeoutMs;
    let lastSignature = null;
    let stable = 0;
    while (Date.now() < end) {
      if (signal.aborted) throw abortError();
      const view = await this._view(page);
      const pager = view?.pagination;
      const count = view?.cardCount || 0;
      const lastPage = pager?.current === target && pager.total === target;
      const validCount = pager && (lastPage ? count >= 1 && count <= 8 : count === 8) &&
        (view.headerCount == null || view.headerCount > 8 || count === view.headerCount);
      if (view?.listingOpen && !view.loading && !view.invalid &&
        ((pager?.current === target && pager.total >= target && validCount) ||
          (target === 1 && view.empty && count === 0 && (!pager || pager.current === 1))) &&
        (previousSignature === null || view.signature !== previousSignature)) {
        stable = view.signature === lastSignature ? stable + 1 : 1;
        if (stable >= 2) return view;
        lastSignature = view.signature;
      } else {
        stable = 0;
        lastSignature = null;
      }
      await sleep(180, signal);
    }
    throw new Error(`My Listings page ${target} did not finish loading or had incomplete player cards.`);
  }

  async _clickPager(page, label, signal) {
    if (signal.aborted) throw abortError();
    const clicked = await page.evaluate(clickMarketPager, label).catch(() => false);
    if (!clicked) throw new Error(`My Listings pager ${label} is not available.`);
  }

  async _firstPage(page, signal) {
    const current = await this._view(page);
    if ((current?.pagination?.current || 1) > 1) {
      await this._clickPager(page, '«', signal);
      return this._waitPage(page, 1, signal, current.signature);
    }
    return this._waitPage(page, 1, signal);
  }

  async _openListings(session, signal) {
    const page = session.page;
    const success = page.locator(SUCCESS_DIALOG).first();
    if (await success.isVisible().catch(() => false)) {
      await success.getByRole('button', { name: /^Continue$/i }).click();
      await success.waitFor({ state: 'hidden', timeout: 15000 });
    }
    const confirm = page.locator(CONFIRM_DIALOG).first();
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.getByRole('button', { name: /^Cancel$/i }).click();
      await confirm.waitFor({ state: 'hidden', timeout: 15000 });
    }
    if (await page.getByRole('heading', { name: /^My Listings$/i }).isVisible().catch(() => false)) {
      return this._firstPage(page, signal);
    }
    await this.browser.normalizeToStadium(session, () => {});
    if (signal.aborted) throw abortError();
    await page.locator(CITY_SELECTOR).first().click({ timeout: 30000 });
    await page.locator(STADIUM_SELECTOR).first().waitFor({ state: 'visible', timeout: 90000 });
    await page.locator(BUILDING_SELECTOR).first().click({ position: { x: 100, y: 60 }, timeout: 90000 });
    const tab = page.getByRole('button', { name: /My Listing\s+Manage your active listings/i }).first();
    await tab.waitFor({ state: 'visible', timeout: 90000 });
    await tab.click();
    await page.getByRole('heading', { name: /^My Listings$/i }).waitFor({ state: 'visible', timeout: 30000 });
    return this._firstPage(page, signal);
  }

  async _scanPages(page, accountId, signal) {
    let view = await this._firstPage(page, signal);
    const rows = [];
    let nextPage = 1;
    while (true) {
      if (signal.aborted) throw abortError();
      if (!view.listingOpen || !view.rows || view.rows.length !== view.cardCount) {
        throw new Error(`My Listings page ${nextPage} could not be read.`);
      }
      rows.push(...view.rows.map(row => ({ ...row, accountId, page: nextPage })));
      this.set(accountId, { rows: [...rows], page: nextPage, totalPages: view.pagination?.total || nextPage });
      if (!view.pagination || nextPage >= view.pagination.total) break;
      const priorSignature = view.signature;
      await this._clickPager(page, '›', signal);
      view = await this._waitPage(page, ++nextPage, signal, priorSignature);
    }
    this.set(accountId, { rows, scannedAt: new Date().toISOString() });
    return rows;
  }

  async open(accountId) {
    return this._operation(accountId, 'scanning', async (account, s, signal) => {
      const session = await this._ensureSession(account, signal);
      await this._openListings(session, signal);
      const rows = await this._scanPages(session.page, account.id, signal);
      if (rows.some(row => row.status === 'SOLD')) {
        this.set(accountId, { status: 'open', error: null });
      } else if (s.pendingApkRefresh) {
        await this._refreshApkAndClose(account, session, signal);
      } else {
        await this._closeSession(accountId);
        this.set(accountId, { status: 'closed', error: null });
      }
      this.log(account, 'success', `Market scanned · ${rows.length} listings · ${rows.filter(row => row.status === 'SOLD').length} sold.`);
      return this.snapshot()[accountId];
    });
  }

  async _goToPage(page, target, signal) {
    let view = await this._firstPage(page, signal);
    for (let number = 2; number <= target; number++) {
      if (!view.pagination || number > view.pagination.total) return null;
      await this._clickPager(page, '›', signal);
      view = await this._waitPage(page, number, signal, view.signature);
    }
    return view;
  }

  async _claimOne(page, row, signal) {
    const current = await this._goToPage(page, row.page, signal);
    if (!current) return false;
    const observed = current.rows[row.index];
    if (!observed || observed.status !== 'SOLD' || observed.fullName !== row.fullName ||
      observed.imagePath !== row.imagePath || observed.price !== row.price || observed.currency !== row.currency) {
      // An account owner may have claimed the sale manually since the scan.
      return false;
    }
    const card = page.locator(LISTING_CARD).nth(row.index);
    await card.getByRole('button', { name: /^Claim$/i }).click({ timeout: 10000 });
    const confirm = page.locator(CONFIRM_DIALOG).first();
    await confirm.waitFor({ state: 'visible', timeout: 15000 });
    const modalText = await confirm.innerText();
    const expectedCurrency = row.currency === 'TIX' ? /\b(?:TIX|GC|TICKET)\b/i : /\bAPK\b/i;
    if (!expectedCurrency.test(modalText)) {
      throw new Error('The Claim confirmation currency does not match the sold listing.');
    }
    if (signal.aborted) throw abortError();
    await confirm.getByRole('button', { name: /^Confirm Claim$/i }).click({ timeout: 10000 });
    if (row.accountId) this.set(row.accountId, { pendingApkRefresh: true });
    // Once Confirm Claim is pressed, only the game's success dialog proves that
    // this sale was collected. Never retry the click on a timeout.
    const success = page.locator(SUCCESS_DIALOG).first();
    await success.waitFor({ state: 'visible', timeout: 30000 });
    if (!/claim successful/i.test(await success.innerText())) throw new Error('Claim result was not verified.');
    await success.getByRole('button', { name: /^Continue$/i }).click({ timeout: 10000 });
    await success.waitFor({ state: 'hidden', timeout: 15000 });
    await this._recoverAfterClaim(page, row.page, signal, current.signature);
    return true;
  }

  async _recoverAfterClaim(page, claimedPage, signal, beforeSignature) {
    if (claimedPage === 1) return this._waitPage(page, 1, signal, beforeSignature);
    // The game can display page 1's cards while the counter still says 4/6.
    // Move back and forward to force the actual claimed page to render.
    const stale = await this._view(page);
    if (!stale?.pagination || stale.pagination.current < claimedPage) return this._firstPage(page, signal);
    await this._clickPager(page, '‹', signal);
    const prior = await this._waitPage(page, claimedPage - 1, signal,
      claimedPage === 2 ? null : stale.signature);
    if (prior.pagination?.total < claimedPage) return this._firstPage(page, signal);
    await this._clickPager(page, '›', signal);
    return this._waitPage(page, claimedPage, signal, prior.signature);
  }

  async _refreshApkAndClose(account, session, signal) {
    const page = session.page;
    const agent = page.locator(AGENT_SELECTOR).first();
    if (!(await agent.isVisible().catch(() => false))) {
      // My Listings Back returns to City. Verify City before selecting Stadium.
      const back = page.getByRole('button', { name: /^Back$/i }).first();
      if (await back.isVisible().catch(() => false)) await back.click();
      else await page.keyboard.press('Escape');
      const stadium = page.locator(STADIUM_SELECTOR).first();
      await stadium.waitFor({ state: 'visible', timeout: 30000 });
      await stadium.click({ timeout: 30000 });
      await agent.waitFor({ state: 'visible', timeout: 60000 });
    }
    const end = Date.now() + 12000;
    let profile = null;
    do {
      if (signal.aborted) throw abortError();
      profile = await page.evaluate(readStadiumTelemetry).catch(() => null);
      if (profile?.apk != null && profile.stadiumReady) break;
      await sleep(250, signal);
    } while (Date.now() < end);
    if (profile?.apk == null || !profile.stadiumReady) {
      throw new Error('Claim completed, but the Stadium APK balance could not be verified. Browser left open for a retry.');
    }
    const { stadiumReady, ...data } = profile;
    this.accountProfile.merge(account.id, data);
    this.set(account.id, { pendingApkRefresh: false });
    await this._closeSession(account.id);
    this.set(account.id, { status: 'closed', error: null });
  }

  async claim(accountId) {
    return this._operation(accountId, 'claiming', async (account, s, signal) => {
      const previouslySold = s.rows.some(row => row.status === 'SOLD');
      if (!previouslySold) throw new Error('No SOLD listings are available for this account.');
      const session = await this._ensureSession(account, signal);
      await this._openListings(session, signal);
      let claims = 0;
      let staleAttempts = 0;
      let finished = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const rows = await this._scanPages(session.page, account.id, signal);
        const sold = rows.find(row => row.status === 'SOLD');
        if (!sold) {
          if (claims === 0) this.set(account.id, { pendingApkRefresh: true });
          finished = true;
          break;
        }
        if (!(await this._claimOne(session.page, sold, signal))) {
          if (++staleAttempts >= 3) throw new Error('The SOLD listing changed while claiming; inspect or refresh before retrying.');
          continue;
        }
        staleAttempts = 0;
        claims++;
        this.set(account.id, { claimed: s.claimed + 1 });
        this.log(account, 'success', `Market sale claimed · ${sold.fullName} · ${sold.price} ${sold.currency}.`);
      }
      if (!finished) throw new Error('Market claim limit reached; remaining sales were left untouched.');
      await this._refreshApkAndClose(account, session, signal);
      this.log(account, 'success', `Market claim completed · ${claims} sale(s) · Stadium APK verified.`);
      return this.snapshot()[accountId];
    });
  }

  async close(accountId) {
    if (this.jobs.has(accountId)) throw new Error('Wait for this Market operation to finish before closing the account.');
    if (this.state(accountId).pendingApkRefresh) {
      throw new Error('The Stadium APK balance must be verified before this Market account can close. Scan again.');
    }
    await this._closeSession(accountId);
    this.set(accountId, { status: 'closed', error: null });
    return this.snapshot()[accountId];
  }

  async remove(accountId) {
    const job = this.jobs.get(accountId);
    if (job) {
      job.controller.abort();
      await job.promise.catch(() => {});
    }
    await this._closeSession(accountId);
    this.states.delete(accountId);
    this.onChanged?.();
  }

  async shutdown() {
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map(job => job.promise));
    for (const id of this.states.keys()) await this._closeSession(id);
  }
}

module.exports = { MarketService, readMarketView, clickMarketPager };
