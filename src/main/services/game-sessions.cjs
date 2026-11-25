// Session cookie + user id per account, read once per app run (an HTTP sign in, the
// browser login only when the game refuses that) and shared by every socket-based service, so
// an account never signs in twice for Market and Tournament.
//
// Many accounts (user 2026-11-25, 1141 accounts): every background service signed in all
// accounts at the same moment, the burst made the HTTP sign ins time out, and ~1000 accounts
// fell back to the Chromium login, 2 at a time — hours of queue that Market and Daily Quiz
// waited behind ("141 hesap kayıtlıyken çalışıyor, 1141 kayıtlıyken çalışmıyor"). Now:
// - HTTP sign ins run HTTP_CONCURRENCY at a time;
// - a busy / timed-out / dropped sign in is tried again over HTTP, never sent to Chromium;
//   Chromium is only for a sign in the game answered and refused;
// - the services the user starts (Market, Quiz, Auto Buy…) sign in before background ones.
const LOGIN_CONCURRENCY = 2;   // Chromium logins at a time
const HTTP_CONCURRENCY = 20;   // HTTP sign ins at a time
const HTTP_TRIES = 4;
const RETRY_WAIT_MS = [2000, 5000, 10000];
const FAIL_LOG_EVERY_MS = 60 * 1000;
// services that run by themselves over every account: they wait behind the user's own jobs
const BACKGROUND = new Set(['session', 'daily-reward', 'daily-routine', 'daily-slot', 'rotation', 'cheer', 'props', 'friends', 'office', 'magic-team', 'scout-hunter']);
const { httpLogin } = require('./http-login.cjs');

// A sign in that did not get an answer (busy server, time out, dropped connection, an error
// page instead of JSON) — not a refusal of the account.
function isTransient(error) {
  if (error?.transient) return true;
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return true;
  return /fetch failed|timed? ?out|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket|network|busy|Unexpected token|JSON|no csrf/i.test(error?.message || '');
}

class GameSessions {
  constructor({ browserService, credentials, accountProfile = null, httpLogin: login = httpLogin, activity = null, retryWaits = RETRY_WAIT_MS }) {
    this.httpLogin = login;
    this.browser = browserService;
    this.credentials = credentials;
    this.accountProfile = accountProfile;
    this.activity = activity;
    this.retryWaits = retryWaits;
    this.cache = new Map();   // accountId -> { userId, cookieHeader }
    this.pending = new Map(); // accountId -> Promise
    this.active = 0;
    this.waiters = [];
    this.httpActive = 0;
    this.httpQueue = { high: [], low: [] };
    this.httpWaiter = new Map(); // accountId -> its place in httpQueue.low (moved up when the user's job asks)
    this.failCount = 0;
    this.failLoggedAt = 0;
  }

  async _slot() {
    if (this.active < LOGIN_CONCURRENCY) { this.active++; return; }
    await new Promise(resolve => this.waiters.push(resolve));
    this.active++;
  }

  _release() {
    this.active--;
    this.waiters.shift()?.();
  }

  // An HTTP sign in place; the slot is handed straight to the next waiter (user's jobs first).
  async _httpSlot(accountId, low) {
    if (this.httpActive < HTTP_CONCURRENCY) { this.httpActive++; return; }
    await new Promise(resolve => {
      const w = { resolve, accountId };
      if (low) { this.httpQueue.low.push(w); this.httpWaiter.set(accountId, w); } else this.httpQueue.high.push(w);
    });
  }

  _httpRelease() {
    const next = this.httpQueue.high.shift() || this.httpQueue.low.shift();
    if (!next) { this.httpActive--; return; }
    if (this.httpWaiter.get(next.accountId) === next) this.httpWaiter.delete(next.accountId);
    next.resolve();
  }

  // a job of the user's asks for an account a background service is still waiting to sign in
  _boost(accountId) {
    const w = this.httpWaiter.get(accountId);
    if (!w) return;
    const i = this.httpQueue.low.indexOf(w);
    if (i >= 0) { this.httpQueue.low.splice(i, 1); this.httpQueue.high.push(w); }
    this.httpWaiter.delete(accountId);
  }

  _noteFailure(error) {
    this.failCount++;
    const now = Date.now();
    if (!this.activity || now - this.failLoggedAt < FAIL_LOG_EVERY_MS) return;
    this.failLoggedAt = now;
    const count = this.failCount;
    this.failCount = 0;
    const msg = String(error?.message || error).slice(0, 160);
    this.activity.add({ level: 'warning', accountId: null, accountName: '', taskName: 'Sign in', code: 'gs.httpRetry', params: { count, error: msg }, message: `Sign in did not get an answer · ${count} time(s) in the last minute · trying again (${msg})` });
  }

  _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // HTTP sign in, HTTP_TRIES times when the game does not answer. Throws `{ refused: true }`
  // when the game answered and refused (then the Chromium login is worth a try).
  async _http(account, low) {
    const password = this.credentials.decryptSecret(account.passwordEncrypted);
    for (let attempt = 1; ; attempt++) {
      await this._httpSlot(account.id, low);
      try {
        return await this.httpLogin(account.login, password);
      } catch (error) {
        if (!isTransient(error)) { error.refused = true; throw error; }
        this._noteFailure(error);
        if (attempt >= HTTP_TRIES) throw error;
      } finally {
        this._httpRelease();
      }
      await this._sleep(this.retryWaits[Math.min(attempt - 1, this.retryWaits.length - 1)] + Math.floor(Math.random() * 1000));
    }
  }

  // { userId, cookieHeader } for the account; `log(level, message)` receives login steps.
  async get(account, { log = () => {}, owner = 'session' } = {}) {
    const cached = this.cache.get(account.id);
    if (cached) return cached;
    const low = BACKGROUND.has(owner);
    if (this.pending.has(account.id)) {
      if (!low) this._boost(account.id);
      return this.pending.get(account.id);
    }
    const promise = (async () => {
      try {
        // HTTP sign in first: no Chromium, no slot to wait for (user 2026-10-31: less RAM, and
        // the browser login timed out when many accounts started together)
        try {
          const session = await this._http(account, low);
          this.cache.set(account.id, session);
          this.accountProfile?.merge?.(account.id, { userId: session.userId });
          return session;
        } catch (error) {
          // no answer from the game: the next request tries again; Chromium would not do better
          if (!error?.refused) throw new Error(`Sign in got no answer from the game (${error?.message || error}).`);
          log('warning', `Sign in without a browser failed (${error.message}) · trying with Chromium.`);
        }
        await this._slot();
        try {
          const result = await this.browser.authenticate(account, {
            login: account.login,
            password: this.credentials.decryptSecret(account.passwordEncrypted)
          }, { visible: false, keepOpen: false, owner: `${owner}:${account.id}`, log });
          if (!result?.userId || !result?.cookieHeader) throw new Error('Session or user ID could not be read.');
          const session = { userId: result.userId, cookieHeader: result.cookieHeader };
          this.cache.set(account.id, session);
          this.accountProfile?.merge?.(account.id, { userId: session.userId });
          return session;
        } finally {
          this._release();
        }
      } finally {
        this.pending.delete(account.id);
        this.httpWaiter.delete(account.id);
      }
    })();
    this.pending.set(account.id, promise);
    return promise;
  }

  // A session read elsewhere (bulk account creation signs in over HTTP).
  seed(accountId, session) {
    if (!session?.userId || !session?.cookieHeader) return;
    this.cache.set(accountId, { userId: session.userId, cookieHeader: session.cookieHeader });
    this.accountProfile?.merge?.(accountId, { userId: session.userId });
  }

  peek(accountId) { return this.cache.get(accountId) || null; }
  invalidate(accountId) { this.cache.delete(accountId); }
}

module.exports = { GameSessions, isTransient, HTTP_CONCURRENCY };
