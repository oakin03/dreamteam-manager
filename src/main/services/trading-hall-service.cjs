const { CITY_SELECTOR, STADIUM_SELECTOR } = require('./browser-service.cjs');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }

const BUILDING_SELECTOR = 'div.absolute.cursor-pointer[style*="top: 260px"][style*="left: 220px"][style*="width: 200px"][style*="height: 120px"]';

function extractTradingCards() {
  const cards = Array.from(document.querySelectorAll('div.group\\/card'));
  const cleanInt = (txt) => {
    if (txt == null) return null;
    const m = String(txt).replace(/[^0-9-]/g, '');
    if (!m || m === '-') return null;
    const n = Number(m);
    return Number.isFinite(n) ? n : null;
  };
  const directTextAfterLabel = (card, wanted) => {
    for (const d of card.querySelectorAll('div')) {
      if ((d.textContent || '').trim() !== wanted) continue;
      const p = d.parentElement;
      if (!p) continue;
      const kids = Array.from(p.children).filter(x => x.tagName === 'DIV');
      if (kids.length >= 2) return (kids[1].textContent || '').trim();
    }
    return '';
  };

  return cards.map(card => {
    const playerImg = Array.from(card.querySelectorAll('img')).find(img => {
      const src = (img.getAttribute('src') || '').toLowerCase();
      return img.getAttribute('alt') && (src.includes('/players/') || src.includes('%2fplayers%2f'));
    });
    if (!playerImg) return null;

    let position = null;
    let grade = null;
    for (const d of card.querySelectorAll('div')) {
      const cls = d.classList;
      const value = (d.textContent || '').trim().toUpperCase();
      if (cls.contains('absolute') && cls.contains('left-0') && cls.contains('top-0.5')) position = value;
      if (cls.contains('absolute') && cls.contains('bottom-1') && cls.contains('right-1.5')) grade = value;
    }

    const salary = cleanInt(directTextAfterLabel(card, 'Salary'));
    const seller = directTextAfterLabel(card, 'Seller') || null;

    let currency = null;
    let price = null;
    const ticket = card.querySelector('img[alt="ticket"]');
    const game = Array.from(card.querySelectorAll('span')).find(s => (s.textContent || '').includes('🎮'));
    const marker = ticket || game;
    if (marker && marker.parentElement) {
      currency = ticket ? 'TIX' : 'APK';
      const nums = Array.from(marker.parentElement.querySelectorAll('span'))
        .map(s => cleanInt(s.textContent))
        .filter(v => v !== null);
      if (nums.length) price = nums[nums.length - 1];
    }

    if (salary === null || price === null || !currency) return null;
    return {
      name: (playerImg.getAttribute('alt') || '').trim(),
      position,
      grade,
      salary,
      base: null,
      value: null,
      valueChange: null,
      price,
      currency,
      seller
    };
  }).filter(Boolean);
}

function readPageState() {
  let pagination = null;
  let firstDisabled = true;
  let prevDisabled = true;
  let nextDisabled = true;
  let lastDisabled = true;

  for (const parent of document.querySelectorAll('div')) {
    const children = Array.from(parent.children || []);
    const buttons = children.filter(el => el.tagName === 'BUTTON');
    if (buttons.length < 4) continue;
    const labels = buttons.map(b => (b.textContent || '').trim());
    if (!['«', '‹', '›', '»'].every(x => labels.includes(x))) continue;
    const span = children.find(el => el.tagName === 'SPAN' && /^(\d+)\s*\/\s*(\d+)$/.test((el.textContent || '').trim()));
    if (!span) continue;
    const m = (span.textContent || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    const disabled = (label) => {
      const btn = buttons.find(b => (b.textContent || '').trim() === label);
      return !btn || !!btn.disabled || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true';
    };
    pagination = { current: Number(m[1]), total: Number(m[2]) };
    firstDisabled = disabled('«');
    prevDisabled = disabled('‹');
    nextDisabled = disabled('›');
    lastDisabled = disabled('»');
    break;
  }

  const text = (document.body.textContent || '').toLowerCase();
  return {
    pagination,
    firstDisabled,
    prevDisabled,
    nextDisabled,
    lastDisabled,
    loadingPlayers: text.includes('loading players'),
    empty: text.includes('no players') || text.includes('no player') || text.includes('no listings') || text.includes('no listing') || text.includes('nothing here'),
    cardCount: document.querySelectorAll('div.group\\/card').length
  };
}

function clickPagerButton(label) {
  for (const parent of document.querySelectorAll('div')) {
    const children = Array.from(parent.children || []);
    const buttons = children.filter(el => el.tagName === 'BUTTON');
    if (buttons.length < 4) continue;
    const labels = buttons.map(b => (b.textContent || '').trim());
    if (!['«', '‹', '›', '»'].every(x => labels.includes(x))) continue;
    const hasPager = children.some(el => el.tagName === 'SPAN' && /^(\d+)\s*\/\s*(\d+)$/.test((el.textContent || '').trim()));
    if (!hasPager) continue;
    const btn = buttons.find(b => (b.textContent || '').trim() === label);
    if (!btn || btn.disabled || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') return false;
    btn.click();
    return true;
  }
  return false;
}

class TradingHallService {
  constructor({ store, credentials, browserService, activity, onChanged }) {
    this.store = store;
    this.credentials = credentials;
    this.browser = browserService;
    this.activity = activity;
    this.onChanged = onChanged;
    this.runtime = { status: 'idle', page: 0, totalPages: 0, count: 0, message: '', startedAt: null, finishedAt: null };
    this.controller = null;
    this.rows = [];
    this.lastUiEmitAt = 0;
  }

  snapshot() { return { ...this.runtime }; }
  rowsSnapshot() { return ['starting', 'running'].includes(this.runtime.status) ? [] : this.rows; }
  clearRows() {
    this.rows = [];
    this.store.saveTradingRows([]);
    this.onChanged?.();
  }

  tradeAccountSafe() {
    const a = this.store.getTradeAccount();
    if (!a) return null;
    const { passwordEncrypted, ...safe } = a;
    return safe;
  }

  log(level, message) {
    const a = this.tradeAccountSafe();
    this.activity.add({ level, accountId: a?.id || 'trade', accountName: a?.name || 'Trade Account', message });
  }

  setRuntime(patch, { emit = true } = {}) {
    Object.assign(this.runtime, patch);
    if (emit) this.onChanged?.();
  }

  emitProgress(force = false) {
    const now = Date.now();
    if (!force && now - this.lastUiEmitAt < 250) return;
    this.lastUiEmitAt = now;
    this.onChanged?.();
  }

  async saveAccount({ name, login, password }) {
    const old = this.store.getTradeAccount();
    const account = {
      id: old?.id || 'trade-account',
      name: String(name || 'Trade Account').trim() || 'Trade Account',
      login: String(login || '').trim(),
      passwordEncrypted: password ? this.credentials.encryptSecret(String(password)) : old?.passwordEncrypted,
      updatedAt: new Date().toISOString()
    };
    if (!account.login || !account.passwordEncrypted) throw new Error('Trade account login and password are required.');
    this.store.saveTradeAccount(account);
    this.onChanged?.();
    return this.tradeAccountSafe();
  }

  async _readCards(page) {
    const value = await page.evaluate(extractTradingCards).catch(() => []);
    return Array.isArray(value) ? value : [];
  }

  async _state(page) {
    return page.evaluate(readPageState).catch(() => null);
  }

  async _waitHall(page, timeoutMs = 90000) {
    const end = Date.now() + timeoutMs;
    let sawLoadingPlayers = false;
    let loadingFinishedAt = null;
    while (Date.now() < end) {
      const state = await this._state(page);
      if (state?.loadingPlayers) {
        sawLoadingPlayers = true;
        loadingFinishedAt = null;
      } else if (sawLoadingPlayers && loadingFinishedAt === null) {
        loadingFinishedAt = Date.now();
      }

      if (state?.pagination || state?.cardCount > 0 || state?.empty) return true;
      if (sawLoadingPlayers && loadingFinishedAt && Date.now() - loadingFinishedAt >= 3000) return true;
      await sleep(100);
    }
    throw new Error('Trading Hall did not become ready.');
  }

  async _openHall(session) {
    const page = session.page;
    const existing = await this._state(page);
    if (existing?.pagination || existing?.cardCount > 0) return;

    await this.browser.normalizeToStadium(session, (l, m) => this.log(l, m));
    const city = page.locator(CITY_SELECTOR).first();
    await city.waitFor({ state: 'visible', timeout: 60000 });
    await city.click();

    await page.locator(STADIUM_SELECTOR).first().waitFor({ state: 'visible', timeout: 90000 }).catch(() => {});
    const building = page.locator(BUILDING_SELECTOR).first();
    await building.waitFor({ state: 'visible', timeout: 90000 });
    await building.click({ position: { x: 100, y: 60 } });
    await this._waitHall(page);
  }

  async _applyCurrency(page, desired) {
    desired = desired || 'APK_TICKET';
    if (desired === 'all') return;
    const selects = page.locator('select');
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const sel = selects.nth(i);
      const values = await sel.locator('option').evaluateAll(els => els.map(x => x.value)).catch(() => []);
      if (values.includes(desired) && values.includes('all')) {
        if (await sel.inputValue().catch(() => '') !== desired) {
          await sel.selectOption(desired);
          await this._waitHall(page, 60000);
        }
        return;
      }
    }
    throw new Error('Trading Hall currency selector was not found.');
  }

  async _waitPage(page, target, signal, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (signal.aborted) throw abortError();
      const state = await this._state(page);
      if (state?.pagination?.current === target && !state.loadingPlayers && (state.cardCount > 0 || state.empty)) return state.pagination;
      await sleep(75);
    }
    throw new Error(`Page ${target} did not finish loading.`);
  }

  async _waitNextReady(page, oldPage, signal, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (signal.aborted) throw abortError();
      const state = await this._state(page);
      const current = state?.pagination?.current || 0;
      const total = state?.pagination?.total || 0;
      if (current > oldPage) return false;
      if (total && current >= total) throw new Error('Last Trading Hall page reached.');
      if (state?.pagination && !state.nextDisabled && !state.loadingPlayers) return true;
      await sleep(75);
    }
    return null;
  }

  async _returnToFirstPage(page, signal) {
    const state = await this._state(page);
    const current = state?.pagination?.current || 1;
    if (current <= 1) return;
    const clicked = await page.evaluate(clickPagerButton, '«').catch(() => false);
    if (!clicked) throw new Error('Trading Hall could not return to page 1.');
    await this._waitPage(page, 1, signal, 25000);
  }

  async _nudgePager(page, oldPage, signal) {
    if (oldPage <= 1) return false;
    const state = await this._state(page);
    if (!state?.pagination || state.pagination.current !== oldPage || state.prevDisabled || state.loadingPlayers) return false;
    this.setRuntime({ message: `Pager recovery · ${oldPage}` }, { emit: false });
    this.emitProgress(true);
    if (!(await page.evaluate(clickPagerButton, '‹').catch(() => false))) return false;
    await this._waitPage(page, oldPage - 1, signal, 20000).catch(() => null);
    const ready = await this._waitNextReady(page, oldPage - 1, signal, 20000);
    if (!ready) return false;
    if (!(await page.evaluate(clickPagerButton, '›').catch(() => false))) return false;
    await this._waitPage(page, oldPage, signal, 20000);
    return true;
  }

  async _advancePage(page, oldPage, signal) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal.aborted) throw abortError();
      try {
        const ready = await this._waitNextReady(page, oldPage, signal, 20000);
        if (ready === null) throw new Error('Next page button stayed disabled.');
        if (ready) {
          const clicked = await page.evaluate(clickPagerButton, '›').catch(() => false);
          if (!clicked) throw new Error('Next page button changed before click.');
        }
        return await this._waitPage(page, oldPage + 1, signal, 20000);
      } catch (error) {
        lastError = error;
        if (attempt === 2) await this._nudgePager(page, oldPage, signal).catch(() => false);
        if (attempt < 3) await sleep(attempt * 350);
      }
    }
    throw new Error(`Page ${oldPage + 1} could not be loaded: ${lastError?.message || 'pager error'}`);
  }

  _saveCurrentRows() {
    this.store.saveTradingRows(this.rows);
  }

  async start({ stopPrice = 9999, scanCurrency = 'APK_TICKET' } = {}) {
    if (this.controller) throw new Error('Trading Hall scan is already running.');
    const account = this.store.getTradeAccount();
    if (!account) throw new Error('Trade account is not configured.');

    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.rows = [];
    this.store.saveTradingRows([]);
    let page = null;
    let auth = null;
    this.setRuntime({
      status: 'starting', page: 0, totalPages: 0, count: 0,
      message: 'Opening Trading Hall…', startedAt: new Date().toISOString(), finishedAt: null
    });

    try {
      auth = await this.browser.authenticate(account, {
        login: account.login,
        password: this.credentials.decryptSecret(account.passwordEncrypted)
      }, { visible: false, keepOpen: true, owner: 'trading-hall', log: (l, m) => this.log(l, m) });

      page = auth.session.page;
      await this._openHall(auth.session);
      if (signal.aborted) throw abortError();
      await this._applyCurrency(page, scanCurrency);
      await this._returnToFirstPage(page, signal);

      let stoppedByPrice = false;
      while (!signal.aborted) {
        const state = await this._state(page);
        const pager = state?.pagination;
        const pageRows = await this._readCards(page);
        const current = pager?.current || Math.max(1, this.runtime.page || 1);
        const total = pager?.total || current;

        for (const row of pageRows) {
          if (Number.isFinite(Number(stopPrice)) && Number(row.price) >= Number(stopPrice)) {
            stoppedByPrice = true;
            break;
          }
          this.rows.push({ ...row, sourcePage: current });
        }

        Object.assign(this.runtime, {
          status: 'running', page: current, totalPages: total, count: this.rows.length, message: `${current}/${total}`
        });
        this.emitProgress(false);

        if (stoppedByPrice || !pager || current >= total) break;
        if (signal.aborted) throw abortError();
        await this._advancePage(page, current, signal);
      }

      if (signal.aborted) throw abortError();
      this._saveCurrentRows();
      this.setRuntime({
        status: 'done', count: this.rows.length,
        message: stoppedByPrice ? 'Stopped at price limit' : 'Completed',
        finishedAt: new Date().toISOString()
      });
      this.log('success', `Trading Hall scan completed · ${this.rows.length} listings.`);
      return this.rows;
    } catch (error) {
      // Keep whatever was already scanned, but write it only once instead of rewriting
      // an ever-growing JSON file on every page.
      this._saveCurrentRows();
      if (error?.name === 'AbortError') {
        this.setRuntime({ status: 'stopped', count: this.rows.length, message: 'Stopped', finishedAt: new Date().toISOString() });
        this.log('warning', 'Trading Hall scan stopped.');
      } else {
        this.setRuntime({ status: 'error', count: this.rows.length, message: error.message, finishedAt: new Date().toISOString() });
        this.log('error', `Trading Hall: ${error.message}`);
      }
      throw error;
    } finally {
      if (page) await page.keyboard.press('Escape').catch(() => {});
      if (auth?.owner) await this.browser.release(account.id, auth.owner, { closeWhenUnused: true }).catch(() => {});
      this.controller = null;
      this.emitProgress(true);
    }
  }

  async stop() {
    if (!this.controller) return true;
    this.controller.abort();
    const end = Date.now() + 15000;
    while (this.controller && Date.now() < end) await sleep(100);
    return true;
  }
}

module.exports = { TradingHallService };
