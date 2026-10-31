// Sign in without a browser (user 2026-10-31: fewer errors, less RAM): the same NextAuth
// requests the game's login page sends — csrf token, credentials callback, session — read
// with plain HTTP. Returns { userId, cookieHeader }, the two things every socket service
// needs. Checked live 2026-10-31 (also for an account that has no team yet, where the
// browser login waits for a main screen that never comes).
const GAME = 'https://www.dreamteamph.com';

async function httpLogin(email, password, { fetchImpl = (...a) => fetch(...a), signal = null, timeoutMs = 20000 } = {}) {
  const jar = {};
  const keep = r => {
    const list = typeof r.headers?.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    for (const c of list) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1); }
  };
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const timer = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : null;
  const sig = signal && timer && AbortSignal.any ? AbortSignal.any([signal, timer]) : signal || timer;
  let r = await fetchImpl(`${GAME}/api/auth/csrf`, { headers: { cookie: cookie() }, signal: sig });
  keep(r);
  const csrfToken = (await r.json())?.csrfToken;
  if (!csrfToken) throw new Error('sign in: no csrf token');
  r = await fetchImpl(`${GAME}/api/auth/callback/credentials`, {
    method: 'POST', redirect: 'manual', signal: sig,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookie() },
    body: new URLSearchParams({ email, password, redirect: 'false', callbackUrl: '/main', csrfToken, json: 'true' }).toString()
  });
  keep(r);
  r = await fetchImpl(`${GAME}/api/auth/session`, { headers: { cookie: cookie() }, signal: sig });
  const session = await r.json().catch(() => null);
  const userId = session?.user?.id;
  if (!userId) throw new Error('sign in failed (wrong password or the game refused)');
  return { userId, cookieHeader: cookie() };
}

module.exports = { httpLogin };
