const { GameSocket } = require('./game-socket.cjs');

// Bulk account creation (user 2026-10-31): "Hesap oluştur" asks a prefix, a count and one
// password; each account gets a temp-mail.io address (prefix lowercased + number) and a
// game account whose team name is the prefix as typed + the same number. Then the first
// steps the game asks for (team from a random X player and the first roster the game
// offers, the logo) and the account joins the daily routine and starts Auto Play, which
// also runs the Daily Signin streak, 600-day sign in, daily tasks and the Friendly Match.
//
// Recorded live 2026-10-31 (no captcha, no mail confirmation):
//   temp-mail.io  POST api.internal.temp-mail.io/api/v3/email/new {name, domain} -> {email}
//   game          POST /api/register {email, password} -> 201
//   /socket/      checkTeamName(name, ack) -> false = free; getXPlayers -> xPlayersList;
//                 updateSelectedXPlayer {userId, player}; requestPlayers {xPlayerId} ->
//                 playersGenerated {starters, bench}; createTeam {userId, teamName, starters,
//                 bench} -> teamCreated {success}; updateAvatar {userId, avatarUrl} (ack)
// Sign in: plain NextAuth credentials over HTTP (csrf, callback/credentials, session), the
// same requests the login page sends. The browser login waits for the main screen, which a
// new account without a team never shows ("Main screen did not become ready", 2026-10-31).
// The session is handed to the shared sessions so the other services use it too.
// Anything else on the way (a captcha page, "too many requests", a refused address) stops
// the run: it is reported, never worked around.
const TEMP_MAIL = 'https://api.internal.temp-mail.io/api/v3';
const GAME = 'https://www.dreamteamph.com';
const NAME_RE = /^[a-zA-Z0-9]{4,10}$/;    // the game's team name rule
const AVATARS = 15;                       // /avatar/avatar1.webp … avatar15.webp
const GAP_MS = 4000;                      // between two accounts
const MAX_COUNT = 50;
const MAX_PARALLEL = 10;
const MAX_FAILURES = 5;      // failures in a row that stop the run

function abortError() { const e = new Error('Aborted'); e.name = 'AbortError'; return e; }
function delay(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class SignupService {
  constructor({ store, activity, sessions, createSocket, addAccount, startAccount, setDaily, isUnfinished = () => false, lastNumber = null, saveLastNumber = null, fetchImpl = null, gapMs = GAP_MS, onChanged }) {
    Object.assign(this, { store, activity, sessions, createSocket, addAccount, startAccount, setDaily, isUnfinished, lastNumber, saveLastNumber, gapMs, onChanged });
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.run = null;
  }

  snapshot() { return this.run ? { ...this.run, controller: undefined } : { running: false, rows: [] }; }
  _changed() { this.onChanged?.(); }
  _log(level, code, params, message, account = null) {
    this.activity?.add({ level, accountId: account?.id || null, accountName: account?.name || params?.name || '', taskName: 'Account creation', code: `su.${code}`, params, message });
  }

  stop() { this.run?.controller?.abort(); }

  // Checks the form; returns the clean values or throws.
  static validate({ prefix, count, password, avatar, parallel }) {
    const p = String(prefix || '').trim();
    const n = Math.floor(Number(count) || 0);
    if (!/^[a-zA-Z0-9]+$/.test(p)) throw new Error('The prefix may only contain letters and digits.');
    if (n < 1 || n > MAX_COUNT) throw new Error(`Choose 1–${MAX_COUNT} accounts.`);
    if (p.length + String(n).length > 10 || p.length + 1 > 10) throw new Error('Prefix + number must fit in 10 characters (the game\'s team name limit).');
    if (String(password || '').length < 6) throw new Error('The password needs at least 6 characters.');
    const av = Math.min(AVATARS, Math.max(1, Math.floor(Number(avatar) || 14)));
    const par = Math.min(MAX_PARALLEL, Math.max(1, Math.floor(Number(parallel) || 5)));
    return { prefix: p, count: n, password: String(password), avatar: av, parallel: par };
  }

  // `count` accounts, `parallel` at a time (user 2026-10-31: 5 or 10 together). Accounts
  // of the prefix registered by an earlier run whose first steps did not finish are done
  // first and count toward `count`. `onProgress({ created })` hears every finished account
  // (main keeps the job so a restart of the app continues it).
  async create(form, { onProgress = null } = {}) {
    if (this.run?.running) throw new Error('Account creation is already running.');
    const { prefix, count, password, avatar, parallel } = SignupService.validate(form);
    const controller = new AbortController();
    this.run = { running: true, prefix, count, parallel, done: 0, created: 0, rows: [], step: null, controller, startedAt: new Date().toISOString() };
    this._changed();
    this._log('info', 'start', { prefix, count, parallel }, `Creating ${count} account(s) · ${prefix}… · ${parallel} at a time`);
    const signal = controller.signal;
    const pending = this._pending(prefix);
    let number = 0;
    let inFlight = 0;
    let failures = 0;
    let fatal = null;
    let domain = null;
    const finished = (row, ok) => {
      if (ok) { row.status = 'done'; row.step = null; this.run.created++; failures = 0; onProgress?.({ created: this.run.created }); }
      this.run.done = this.run.rows.filter(r => r.status !== 'working').length;
      this._changed();
    };
    const fail = (row, name, error) => {
      row.status = 'error'; row.error = error.message;
      this._log('error', 'failed', { name, error: error.message }, `${name} could not be created: ${error.message}`);
      // a refusal of the game or of the mail service stops the run: never forced; five
      // failures in a row too
      if (error.stopRun || ++failures >= MAX_FAILURES) fatal ||= error.stopRun ? error : new Error(`${MAX_FAILURES} accounts in a row failed (last: ${error.message})`);
    };
    const worker = async index => {
      await delay(index * this.gapMs, signal);
      while (!fatal && this.run.created + inFlight < count) {
        if (signal.aborted) throw abortError();
        inFlight++;
        try {
          const acc = pending.shift();
          if (acc) {
            const row = { teamName: acc.name, email: acc.login, accountId: acc.id, status: 'working', step: 'team', error: null };
            this.run.rows.push(row); this._changed();
            try { await this._setup({ account: acc, teamName: acc.name, email: acc.login, password, avatar, row, signal }); finished(row, true); } catch (error) { if (error?.name === 'AbortError') throw error; fail(row, acc.name, error); finished(row, false); }
            continue;
          }
          domain ||= await this._domain(signal);
          number = this._nextNumber(prefix, number);
          const teamName = `${prefix}${number}`;
          if (!NAME_RE.test(teamName)) { fatal ||= new Error(`${teamName} does not fit the game's team name rule (4–10 letters/digits).`); break; }
          const row = { teamName, email: null, status: 'working', step: 'mail', error: null };
          this.run.rows.push(row); this._changed();
          try {
            const result = await this._createOne({ teamName, password, avatar, domain, row, signal });
            if (result === 'taken') { row.status = 'skipped'; row.error = 'taken'; finished(row, false); continue; }
            finished(row, true);
          } catch (error) { if (error?.name === 'AbortError') throw error; fail(row, teamName, error); finished(row, false); }
        } finally { inFlight--; }
        await delay(this.gapMs, signal);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(parallel, count) }, (_, i) => worker(i)));
      if (fatal) throw fatal;
      this._log('success', 'done', { n: this.run.created }, `${this.run.created} account(s) created`);
      this.run.outcome = 'done';
    } catch (error) {
      if (error?.name === 'AbortError') { this._log('warning', 'stopped', { n: this.run.created }, `Account creation stopped · ${this.run.created} created`); this.run.outcome = 'stopped'; }
      else { this._log('error', 'runStopped', { error: error.message, n: this.run.created }, `Account creation stopped: ${error.message}`); this.run.outcome = 'failed'; }
      this.run.error = error?.name === 'AbortError' ? null : error.message;
    } finally {
      this.run.running = false;
      this.run.controller = null;
      this.run.finishedAt = new Date().toISOString();
      this._changed();
    }
    return this.snapshot();
  }

  // Accounts of this prefix registered earlier whose team / logo step did not finish.
  _pending(prefix) {
    const p = prefix.toLowerCase();
    return this.store.getAccounts().filter(a => (a.signupPending || this.isUnfinished(a)) && String(a.name).toLowerCase().startsWith(p));
  }

  _markDone(accountId) {
    if (typeof this.store.saveAccounts !== 'function') return;
    const accounts = this.store.getAccounts();
    const a = accounts.find(x => x.id === accountId);
    if (a?.signupPending) { delete a.signupPending; this.store.saveAccounts(accounts); }
  }

  // NextAuth sign in over HTTP: { userId, cookieHeader }.
  async _login(email, password, signal) {
    const jar = {};
    const keep = r => {
      const list = typeof r.headers?.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
      for (const c of list) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1); }
    };
    const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    let r = await this.fetch(`${GAME}/api/auth/csrf`, { headers: { cookie: cookie() }, signal });
    keep(r);
    const csrfToken = (await r.json())?.csrfToken;
    if (!csrfToken) throw new Error('sign in: no csrf token');
    r = await this.fetch(`${GAME}/api/auth/callback/credentials`, {
      method: 'POST', redirect: 'manual', signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie: cookie() },
      body: new URLSearchParams({ email, password, redirect: 'false', callbackUrl: '/main', csrfToken, json: 'true' }).toString()
    });
    keep(r);
    r = await this.fetch(`${GAME}/api/auth/session`, { headers: { cookie: cookie() }, signal });
    const session = await r.json().catch(() => null);
    const userId = session?.user?.id;
    if (!userId) throw new Error('sign in failed (wrong password or the game refused)');
    return { userId, cookieHeader: cookie() };
  }

  // A prefix continues after its highest number (user 2026-10-31: "Pipelne" again starts at
  // 51 after 50): the highest of the app's accounts and of the numbers used before (kept
  // even when an account is deleted). Numbers in between are never reused.
  _highest(prefix) {
    const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
    const inApp = this.store.getAccounts().map(a => Number(re.exec(String(a.name))?.[1] || 0));
    return Math.max(0, Number(this.lastNumber?.(prefix)) || 0, ...inApp);
  }

  // The next free number after `after` (taken names in the game are skipped by the caller).
  _nextNumber(prefix, after) {
    const names = new Set(this.store.getAccounts().map(a => String(a.name).toLowerCase()));
    let n = Math.max(after, this._highest(prefix)) + 1;
    while (names.has(`${prefix}${n}`.toLowerCase())) n++;
    this.saveLastNumber?.(prefix, n);
    return n;
  }

  async _domain(signal) {
    const r = await this.fetch(`${TEMP_MAIL}/domains`, { signal });
    if (!r.ok) throw Object.assign(new Error(`temp-mail.io answered ${r.status}`), { stopRun: true });
    const list = (await r.json())?.domains?.filter(d => d.type === 'public').map(d => d.name) || [];
    if (!list.length) throw Object.assign(new Error('temp-mail.io gave no domain'), { stopRun: true });
    return list.includes('lnovic.com') ? 'lnovic.com' : list[0];
  }

  async _json(url, body, signal) {
    const r = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { status: r.status, ok: r.ok, data, text };
  }

  async _createOne({ teamName, password, avatar, domain, row, signal }) {
    const step = s => { row.step = s; this.run.step = `${teamName} · ${s}`; this._changed(); };
    // the name first (anonymous socket): a taken team name is skipped before any mail
    step('name');
    const anon = await GameSocket.open({ createSocket: this.createSocket, signal });
    try {
      const taken = await anon.ack('checkTeamName', teamName, { signal, timeoutMs: 10000 });
      if (taken) { this._log('info', 'taken', { name: teamName }, `${teamName} is taken in the game · next number`); return 'taken'; }
    } finally { try { anon.close(); } catch {} }

    step('mail');
    const mail = await this._json(`${TEMP_MAIL}/email/new`, { name: teamName.toLowerCase(), domain }, signal);
    if (!mail.ok || !mail.data?.email) throw Object.assign(new Error(`temp-mail.io refused the address (${mail.status} ${String(mail.data?.error || mail.text).slice(0, 80)})`), { stopRun: true });
    row.email = mail.data.email;

    step('register');
    const reg = await this._json(`${GAME}/api/register`, { email: row.email, password }, signal);
    if (!reg.ok) {
      const why = String(reg.data?.message || reg.data?.error || reg.text || '').slice(0, 120);
      // a captcha / rate limit is the game saying no: stop, do not retry around it
      throw Object.assign(new Error(`registration refused (${reg.status}${why ? ` · ${why}` : ''})`), { stopRun: reg.status === 429 || reg.status === 403 || /captcha|too many|rate/i.test(why) });
    }
    const account = await this.addAccount({ name: teamName, login: row.email, password, signupPending: true });
    row.accountId = account.id;
    this._log('success', 'registered', { name: teamName, email: row.email }, `${teamName} registered · ${row.email}`, account);
    await this._setup({ account, teamName, email: row.email, password, avatar, row, signal });
    return 'created';
  }

  // Team, logo, daily routine, Auto Play of a registered account.
  async _setup({ account, teamName, email, password, avatar, row, signal }) {
    const step = s => { row.step = s; this.run.step = `${teamName} · ${s}`; this._changed(); };
    step('team');
    const full = this.store.getAccounts().find(a => a.id === account.id) || account;
    const session = await this._login(email, password, signal);
    this.sessions?.seed?.(account.id, session);
    const { userId, cookieHeader: cookie } = session;
    const gs = await GameSocket.open({ createSocket: this.createSocket, cookie, signal });
    try {
      await gs.register(userId, { signal, owner: 'Account creation' });
      // a team made by an earlier run is kept (its name is not "team-<id>" any more)
      const info = await gs.call('getUserBasicInfo', { userId }, 'userBasicInfo', { signal, timeoutMs: 10000 }).catch(() => null);
      const hasTeam = info?.teamName && !String(info.teamName).startsWith('team-');
      if (!hasTeam) {
        const xs = await gs.call('getXPlayers', { userId }, 'xPlayersList', { signal, timeoutMs: 20000, errorEvents: ['error'] });
        const list = Array.isArray(xs) ? xs : [];
        if (!list.length) throw new Error('the game offered no X player');
        const x = list[Math.floor(Math.random() * list.length)];
        gs.socket.emit('updateSelectedXPlayer', { userId, player: x });
        const roster = await gs.call('requestPlayers', { xPlayerId: x.id }, 'playersGenerated', { signal, timeoutMs: 20000, errorEvents: ['error'] });
        if (!roster?.starters?.length) throw new Error('the game offered no roster');
        const made = await gs.call('createTeam', { userId, teamName, starters: roster.starters, bench: roster.bench || [] }, 'teamCreated', { signal, timeoutMs: 20000, errorEvents: ['error'] });
        if (!made?.success) throw new Error(`team not created (${made?.teamName || made?.error || 'refused'})`);
        this._log('success', 'team', { name: teamName, x: x.visualName || x.name }, `${teamName} team created · X player ${x.visualName || x.name}`, full);
      }

      step('logo');
      const av = await gs.ack('updateAvatar', { userId, avatarUrl: `/avatar/avatar${avatar}.webp` }, { signal, timeoutMs: 10000 });
      if (!av?.success) this._log('warning', 'logoFailed', { name: teamName }, `${teamName} logo could not be set`, full);
    } finally { try { gs.close(); } catch {} }

    // daily routine (Daily Signin streak, 600-day, tasks, Friendly Match) runs at the
    // Auto Play start
    this._markDone(account.id);
    step('start');
    this.setDaily?.(account.id);
    await this.startAccount?.(account.id).catch(error => this._log('warning', 'startFailed', { name: teamName, error: error.message }, `${teamName} Auto Play could not start: ${error.message}`, full));
  }
}

module.exports = { SignupService, NAME_RE, AVATARS };
