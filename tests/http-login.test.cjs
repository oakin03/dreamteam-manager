const { test } = require('node:test');
const assert = require('node:assert/strict');
const { httpLogin } = require('../src/main/services/http-login.cjs');
const { GameSessions } = require('../src/main/services/game-sessions.cjs');

function fakeFetch({ good = 'pw' } = {}) {
  return async (url, init = {}) => {
    const res = (data, cookies = []) => ({ status: 200, ok: true, headers: { getSetCookie: () => cookies }, json: async () => data });
    if (url.endsWith('/api/auth/csrf')) return res({ csrfToken: 'tok' }, ['__Host-next-auth.csrf-token=abc; Path=/']);
    if (url.endsWith('/api/auth/callback/credentials')) {
      const f = new URLSearchParams(init.body);
      assert.equal(f.get('csrfToken'), 'tok');
      return res({ url: '/main' }, f.get('password') === good ? [`__Secure-next-auth.session-token=s-${f.get('email')}; Path=/`] : []);
    }
    if (url.endsWith('/api/auth/session')) { const m = /session-token=s-([^;]+)/.exec(init.headers.cookie); return res(m ? { user: { id: 'u-' + m[1] } } : {}); }
    throw new Error(url);
  };
}

test('HTTP sign in returns the user id and the session cookie', async () => {
  const s = await httpLogin('a@b.c', 'pw', { fetchImpl: fakeFetch() });
  assert.equal(s.userId, 'u-a@b.c');
  assert.match(s.cookieHeader, /session-token=s-a@b.c/);
  await assert.rejects(httpLogin('a@b.c', 'bad', { fetchImpl: fakeFetch() }), /sign in failed/);
});

test('shared sessions sign in over HTTP and open Chromium only when that fails', async () => {
  let browser = 0;
  const make = login => new GameSessions({
    browserService: { authenticate: async () => { browser++; return { userId: 'u-browser', cookieHeader: 'c=1' }; } },
    credentials: { decryptSecret: () => 'pw' }, httpLogin: login
  });
  const ok = make(async email => ({ userId: 'u-' + email, cookieHeader: 'x=1' }));
  assert.equal((await ok.get({ id: 'a', login: 'a@b.c' })).userId, 'u-a@b.c');
  assert.equal(browser, 0);
  const failing = make(async () => { throw new Error('refused'); });
  assert.equal((await failing.get({ id: 'b', login: 'b@b.c' })).userId, 'u-browser');
  assert.equal(browser, 1);
});
