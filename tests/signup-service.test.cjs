const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SignupService } = require('../src/main/services/signup-service.cjs');
const { AppStore } = require('../src/main/services/store.cjs');

// A game where "Farm1" is taken; X players, a roster and the team / avatar events answer.
function fakeGame({ taken = ['farm1'], registerStatus = 201 } = {}) {
  const calls = [];
  const teams = new Set(taken);
  const createSocket = () => {
    const s = new EventEmitter();
    s.off = s.removeListener; s.connected = true;
    s.close = () => { s.closed = true; };
    const local = EventEmitter.prototype.emit.bind(s);
    const reply = (name, data) => setTimeout(() => !s.closed && local(name, data), 1);
    s.emit = (event, payload) => {
      calls.push({ event, payload });
      if (event === 'register') reply('registrationSuccess', {});
      if (event === 'getUserBasicInfo') reply('userBasicInfo', { success: true, teamName: 'team-x' });
      if (event === 'getXPlayers') reply('xPlayersList', [{ id: 'x1', name: 'Luka Doncic', visualName: 'Luka Doncic' }, { id: 'x2', name: 'Kyrie Irving' }]);
      if (event === 'requestPlayers') reply('playersGenerated', { starters: [{ id: payload.xPlayerId, assignedSlot: 'PG' }, { id: 'p2' }], bench: [{ id: 'p3' }] });
      if (event === 'createTeam') { teams.add(payload.teamName.toLowerCase()); reply('teamCreated', { success: true, teamName: payload.teamName }); }
      return true;
    };
    s.timeout = () => ({
      emit: (event, payload, cb) => {
        calls.push({ event, payload });
        if (event === 'checkTeamName') setTimeout(() => cb(null, teams.has(String(payload).toLowerCase())), 1);
        if (event === 'updateAvatar') setTimeout(() => cb(null, { success: true, avatarUrl: payload.avatarUrl }), 1);
      }
    });
    setTimeout(() => local('connect'), 1);
    return s;
  };
  const fetchImpl = async (url, init = {}) => {
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch {}
    calls.push({ event: url, payload: body });
    const res = (status, data, cookies = []) => ({ status, ok: status < 300, headers: { getSetCookie: () => cookies }, json: async () => data, text: async () => JSON.stringify(data) });
    // NextAuth sign in over HTTP
    if (url.endsWith('/api/auth/csrf')) return res(200, { csrfToken: 'tok' }, ['__Host-next-auth.csrf-token=abc; Path=/']);
    if (url.endsWith('/api/auth/callback/credentials')) { const form = new URLSearchParams(init.body); calls.push({ event: 'login', payload: form.get('email') }); return res(200, { url: '/main' }, [`__Secure-next-auth.session-token=s-${form.get('email')}; Path=/`]); }
    if (url.endsWith('/api/auth/session')) { const m = /session-token=s-([^;]+)/.exec(init.headers?.cookie || ''); return res(200, m ? { user: { id: `u-${m[1]}` } } : {}); }
    if (url.endsWith('/domains')) return res(200, { domains: [{ name: 'yzcalo.com', type: 'public' }, { name: 'lnovic.com', type: 'public' }] });
    if (url.endsWith('/email/new')) return res(200, { email: `${body.name}@${body.domain}`, token: 't' });
    if (url.endsWith('/api/register')) return registerStatus === 201 ? res(201, { message: 'User registered successfully' }) : res(registerStatus, { message: 'Too many requests' });
    throw new Error('unexpected ' + url);
  };
  return { createSocket, fetchImpl, calls };
}

function service(game, existing = [], extra = {}) {
  const accounts = existing.map(n => (typeof n === 'string' ? { id: n, name: n } : n));
  const seeded = [];
  const numbers = {};
  const logs = [];
  const daily = [];
  const started = [];
  const svc = new SignupService({
    store: { getAccounts: () => accounts },
    activity: { add: e => logs.push(e) },
    sessions: { seed: (id, s) => seeded.push([id, s.userId]) },
    lastNumber: p => numbers[p.toLowerCase()] || 0, saveLastNumber: (p, n) => { numbers[p.toLowerCase()] = Math.max(numbers[p.toLowerCase()] || 0, n); },
    ...extra,
    createSocket: game.createSocket, fetchImpl: game.fetchImpl, gapMs: 0,
    addAccount: p => { const a = { id: `id-${p.name}`, name: p.name, login: p.login }; accounts.push(a); return a; },
    setDaily: id => daily.push(id),
    startAccount: async id => { started.push(id); }
  });
  return { svc, accounts, logs, daily, started, seeded, numbers };
}

test('bulk creation: prefix + number, lower-case mail, taken names skipped, team + logo + routine + Auto Play', async () => {
  const game = fakeGame({ taken: ['farm1'] });
  const { svc, accounts, daily, started } = service(game, ['Farm2']);   // Farm2 is in the app already
  const snap = await svc.create({ prefix: 'Farm', count: 2, password: 'secret1', avatar: 7 });
  assert.equal(snap.running, false);
  assert.deepEqual(accounts.map(a => a.name), ['Farm2', 'Farm3', 'Farm4'], 'Farm1 taken in the game, Farm2 in the app');
  assert.deepEqual(accounts.slice(1).map(a => a.login), ['farm3@lnovic.com', 'farm4@lnovic.com']);
  const regs = game.calls.filter(c => c.event.endsWith?.('/api/register'));
  assert.deepEqual(regs.map(r => r.payload), [{ email: 'farm3@lnovic.com', password: 'secret1' }, { email: 'farm4@lnovic.com', password: 'secret1' }]);
  const created = game.calls.filter(c => c.event === 'createTeam');
  assert.deepEqual(created.map(c => c.payload.teamName), ['Farm3', 'Farm4'], 'the prefix keeps its capitals');
  assert.equal(created[0].payload.bench.length, 1);
  assert.ok(game.calls.filter(c => c.event === 'updateAvatar').every(c => c.payload.avatarUrl === '/avatar/avatar7.webp'));
  assert.deepEqual(daily, ['id-Farm3', 'id-Farm4']);
  assert.deepEqual(started, ['id-Farm3', 'id-Farm4']);
  assert.equal(snap.rows.filter(r => r.status === 'done').length, 2);
});

test('a refused registration (rate limit) stops the run instead of retrying', async () => {
  const game = fakeGame({ taken: [], registerStatus: 429 });
  const { svc, accounts, logs } = service(game);
  // one at a time: the refusal stops the run before another sign-up is sent
  const snap = await svc.create({ prefix: 'Farm', count: 3, password: 'secret1', avatar: 1, parallel: 1 });
  assert.equal(accounts.length, 0);
  assert.equal(game.calls.filter(c => c.event.endsWith?.('/api/register')).length, 1);
  assert.match(snap.error, /429/);
  assert.ok(logs.some(l => l.code === 'su.runStopped'));
});

test('the form is checked: letters/digits only, prefix + number within 10 characters, password 6+', () => {
  assert.throws(() => SignupService.validate({ prefix: 'Farm-', count: 2, password: 'secret1' }));
  assert.throws(() => SignupService.validate({ prefix: 'FarmFarmFa', count: 2, password: 'secret1' }));
  assert.throws(() => SignupService.validate({ prefix: 'Farm', count: 2, password: '123' }));
  assert.deepEqual(SignupService.validate({ prefix: 'CCAcc', count: 20, password: '123456', avatar: 99 }), { prefix: 'CCAcc', count: 20, password: '123456', avatar: 15, parallel: 5 });
  assert.equal(SignupService.validate({ prefix: 'Farm', count: 2, password: '123456', parallel: 99 }).parallel, 10);
});

test('"2. Main" is the main account for the automations only while there is no Main', () => {
  const store = Object.create(AppStore.prototype);
  let profile = { version: 1, mainAccountId: 'm', secondMainId: 's', accounts: {} };
  store.getAccounts = () => [{ id: 'm' }, { id: 's' }, { id: 'x' }];
  store.getAccountProfileRaw = () => profile;
  assert.equal(store.getAccountProfile().mainAccountId, 'm');
  profile = { ...profile, mainAccountId: null };
  assert.equal(store.getAccountProfile().mainAccountId, 's');
  assert.equal(store.getAccountProfile().realMainAccountId, null);
});

test('signs in over HTTP (no browser) and hands the session to the shared sessions', async () => {
  const game = fakeGame({ taken: [] });
  const { svc, seeded } = service(game);
  await svc.create({ prefix: 'Farm', count: 1, password: 'secret1', avatar: 1 });
  assert.deepEqual(seeded, [['id-Farm1', 'u-farm1@lnovic.com']]);
  assert.ok(game.calls.some(c => c.event === 'login' && c.payload === 'farm1@lnovic.com'));
});

test('a prefix goes on after its highest number, also after the accounts were deleted', async () => {
  const game = fakeGame({ taken: [] });
  const { svc, accounts, numbers } = service(game, ['Pipelne50', 'Pipelne7']);
  await svc.create({ prefix: 'Pipelne', count: 1, password: 'secret1', avatar: 1 });
  assert.equal(accounts.at(-1).name, 'Pipelne51');
  const again = service(fakeGame({ taken: [] }), []);
  again.numbers.pipelne = numbers.pipelne;   // the accounts are gone, the number is kept
  Object.assign(again.svc, { lastNumber: p => again.numbers[p.toLowerCase()] || 0 });
  await again.svc.create({ prefix: 'Pipelne', count: 1, password: 'secret1', avatar: 1 });
  assert.equal(again.accounts.at(-1).name, 'Pipelne52');
});

test('several accounts at the same time; half-done accounts of an earlier run are finished first', async () => {
  const game = fakeGame({ taken: [] });
  const half = { id: 'h1', name: 'Farm1', login: 'farm1@lnovic.com', signupPending: true };
  const { svc, accounts } = service(game, [half]);
  let peak = 0; let now = 0;
  const orig = svc._setup.bind(svc);
  svc._setup = async (...a) => { now++; peak = Math.max(peak, now); try { return await orig(...a); } finally { now--; } };
  const snap = await svc.create({ prefix: 'Farm', count: 6, password: 'secret1', avatar: 1, parallel: 5 });
  assert.equal(snap.created, 6);
  assert.equal(accounts.length, 6, 'Farm1 finished, Farm2…Farm6 new');
  assert.ok(game.calls.some(c => c.event === 'createTeam' && c.payload.teamName === 'Farm1'));
  assert.ok(peak > 1, 'accounts ran side by side (peak ' + peak + ')');
  assert.equal(game.calls.filter(c => c.event.endsWith?.('/api/register')).length, 5);
});
