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

test('a sign in the game did not answer is tried again over HTTP, never sent to Chromium', async () => {
  let browser = 0, calls = 0;
  const s = new GameSessions({
    browserService: { authenticate: async () => { browser++; return { userId: 'u-browser', cookieHeader: 'c=1' }; } },
    credentials: { decryptSecret: () => 'pw' }, retryWaits: [1],
    httpLogin: async email => { if (++calls < 3) { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; } return { userId: 'u-' + email, cookieHeader: 'x=1' }; }
  });
  assert.equal((await s.get({ id: 'a', login: 'a@b.c' })).userId, 'u-a@b.c');
  assert.equal(calls, 3);
  assert.equal(browser, 0);
  const down = new GameSessions({
    browserService: { authenticate: async () => { browser++; return { userId: 'u-browser', cookieHeader: 'c=1' }; } },
    credentials: { decryptSecret: () => 'pw' }, retryWaits: [1],
    httpLogin: async () => { const e = new Error('sign in: game busy (callback 429)'); e.transient = true; throw e; }
  });
  await assert.rejects(down.get({ id: 'b', login: 'b@b.c' }), /no answer/);
  assert.equal(browser, 0);
  assert.equal(down.pending.size, 0, 'the next request may try again');
});

test('HTTP sign ins run a limited number at a time and the user\'s jobs go before background ones', async () => {
  const { HTTP_CONCURRENCY } = require('../src/main/services/game-sessions.cjs');
  let running = 0, most = 0;
  const order = [];
  const gates = [];
  const s = new GameSessions({
    browserService: { authenticate: async () => { throw new Error('no browser'); } },
    credentials: { decryptSecret: () => 'pw' },
    httpLogin: async email => { running++; most = Math.max(most, running); order.push(email); await new Promise(r => gates.push(r)); running--; return { userId: 'u-' + email, cookieHeader: 'x=1' }; }
  });
  const all = [];
  for (let i = 0; i < 60; i++) all.push(s.get({ id: 'bg' + i, login: 'bg' + i }, { owner: 'daily-reward' }));
  all.push(s.get({ id: 'm1', login: 'm1' }, { owner: 'market' }));
  all.push(s.get({ id: 'bg50', login: 'bg50' }, { owner: 'quiz' })); // waiting in the background line: moved up
  await new Promise(r => setImmediate(r));
  assert.equal(running, HTTP_CONCURRENCY);
  const release = async () => { while (gates.length) { gates.shift()(); await new Promise(r => setImmediate(r)); } };
  gates.shift()(); await new Promise(r => setImmediate(r));
  gates.shift()(); await new Promise(r => setImmediate(r));
  assert.deepEqual(order.slice(HTTP_CONCURRENCY, HTTP_CONCURRENCY + 2), ['m1', 'bg50']);
  while (order.length < 61 || gates.length) await release();
  await Promise.all(all);
  assert.equal(most, HTTP_CONCURRENCY);
});
