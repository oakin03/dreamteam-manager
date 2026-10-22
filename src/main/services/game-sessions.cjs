// Session cookie + user id per account, read once per app run through a
// short headless login and shared by every socket-based service, so an
// account never signs in twice for Market and Tournament.
const LOGIN_CONCURRENCY = 2;

class GameSessions {
  constructor({ browserService, credentials, accountProfile = null }) {
    this.browser = browserService;
    this.credentials = credentials;
    this.accountProfile = accountProfile;
    this.cache = new Map();   // accountId -> { userId, cookieHeader }
    this.pending = new Map(); // accountId -> Promise
    this.active = 0;
    this.waiters = [];
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

  // { userId, cookieHeader } for the account; `log(level, message)` receives login steps.
  async get(account, { log = () => {}, owner = 'session' } = {}) {
    const cached = this.cache.get(account.id);
    if (cached) return cached;
    if (this.pending.has(account.id)) return this.pending.get(account.id);
    const promise = (async () => {
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
        this.pending.delete(account.id);
      }
    })();
    this.pending.set(account.id, promise);
    return promise;
  }

  peek(accountId) { return this.cache.get(accountId) || null; }
  invalidate(accountId) { this.cache.delete(accountId); }
}

module.exports = { GameSessions };
